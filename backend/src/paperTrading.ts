import { pool } from './db.js';

const number = (value: unknown): number => Number(value ?? 0);
const bounded = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export const paperConfig = {
  symbols: [...new Set((process.env.PAPER_SYMBOLS ?? 'BTC/USDT,ETH/USDT,SOL/USDT')
    .split(',').map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => /^[A-Z0-9]+\/[A-Z0-9]+$/.test(symbol)))].slice(0, 20),
  startingBalance: bounded(process.env.PAPER_INITIAL_BALANCE, 1000, 100, 10_000_000),
  maxTradePct: bounded(process.env.PAPER_MAX_TRADE_PCT, 0.1, 0.01, 1),
  maxExposurePct: bounded(process.env.PAPER_MAX_EXPOSURE_PCT, 0.7, 0.1, 1),
  maxOpenTrades: Math.floor(bounded(process.env.PAPER_MAX_OPEN_TRADES, 5, 1, 100)),
  feeRate: bounded(process.env.PAPER_FEE_RATE, 0.001, 0, 0.05),
  slippageRate: bounded(process.env.PAPER_SLIPPAGE_RATE, 0.0005, 0, 0.05),
  maxDrawdownPct: bounded(process.env.PAPER_MAX_DRAWDOWN_PCT, 0.15, 0.01, 0.9),
  outcomeHorizonCandles: Math.floor(bounded(process.env.PAPER_OUTCOME_HORIZON_CANDLES, 12, 1, 1000)),
  autoAnalyze: process.env.PAPER_AUTO_ANALYZE === 'true',
  autoTimeframe: /^\d+[mhdw]$/.test(process.env.PAPER_AUTO_TIMEFRAME ?? '') ? process.env.PAPER_AUTO_TIMEFRAME as string : '5m'
};

export type MarketSnapshot = {
  price: number | null;
  high?: number | null;
  low?: number | null;
  date?: string | number | null;
  indicators?: Record<string, unknown>;
};

export type PaperResult = { action: string; message: string; portfolio: Record<string, unknown> };

export async function initializePaperPortfolio() {
  await pool.query(`INSERT INTO paper_portfolio(id,currency,initial_balance,cash_balance,peak_equity)
    VALUES(1,'USDT',$1,$1,$1) ON CONFLICT(id) DO NOTHING`, [paperConfig.startingBalance]);
}

export async function portfolioSnapshot() {
  const { rows } = await pool.query(`
    SELECT p.*,
      COALESCE(SUM(t.amount * COALESCE(t.last_price, t.entry)), 0) AS market_value,
      COALESCE(SUM((COALESCE(t.last_price, t.entry) - t.entry) * t.amount - t.entry_fee
        - COALESCE(t.last_price, t.entry) * t.amount * $1), 0) AS unrealized_pnl,
      COUNT(t.id)::int AS open_positions
    FROM paper_portfolio p
    LEFT JOIN simulated_trades t ON t.status='open'
    WHERE p.id=1
    GROUP BY p.id`, [paperConfig.feeRate + paperConfig.slippageRate]);
  const account = rows[0];
  if (!account) throw new Error('Paper portfolio has not been initialized. Apply database migrations.');
  const equity = number(account.cash_balance) + number(account.market_value) * (1 - paperConfig.feeRate - paperConfig.slippageRate);
  const peak = Math.max(number(account.peak_equity), equity);
  const drawdownPct = peak > 0 ? Math.max(0, (peak - equity) / peak) : 0;
  const tradeStats = await pool.query(`
    SELECT COUNT(*)::int AS closed_trades,
      COUNT(*) FILTER (WHERE pnl > 0)::int AS winning_trades,
      COUNT(*) FILTER (WHERE pnl < 0)::int AS losing_trades,
      COALESCE(SUM(pnl), 0) AS closed_pnl
    FROM simulated_trades WHERE status='closed' AND decision_id IS NOT NULL`);
  const stats = tradeStats.rows[0];
  return {
    currency: account.currency,
    initialBalance: number(account.initial_balance),
    cashBalance: number(account.cash_balance),
    marketValue: number(account.market_value),
    equity,
    realizedPnl: number(account.realized_pnl),
    unrealizedPnl: number(account.unrealized_pnl),
    returnPct: number(account.initial_balance) > 0 ? (equity - number(account.initial_balance)) / number(account.initial_balance) : 0,
    peakEquity: peak,
    drawdownPct,
    openPositions: number(account.open_positions),
    closedTrades: number(stats.closed_trades),
    winningTrades: number(stats.winning_trades),
    losingTrades: number(stats.losing_trades),
    winRate: number(stats.closed_trades) > 0 ? number(stats.winning_trades) / number(stats.closed_trades) : null,
    settings: {
      maxTradePct: paperConfig.maxTradePct,
      maxExposurePct: paperConfig.maxExposurePct,
      maxOpenTrades: paperConfig.maxOpenTrades,
      feeRate: paperConfig.feeRate,
      slippageRate: paperConfig.slippageRate,
      maxDrawdownPct: paperConfig.maxDrawdownPct,
      outcomeHorizonCandles: paperConfig.outcomeHorizonCandles
    }
  };
}

async function closePosition(client: any, trade: any, exitPrice: number, reason: string) {
  const quantity = number(trade.amount);
  const entry = number(trade.entry);
  const entryFee = number(trade.entry_fee);
  exitPrice = exitPrice * (1 - paperConfig.slippageRate);
  const exitFee = exitPrice * quantity * paperConfig.feeRate;
  const pnl = (exitPrice - entry) * quantity - entryFee - exitFee;
  const proceeds = exitPrice * quantity - exitFee;
  await client.query(`UPDATE simulated_trades SET exit=$2, last_price=$2, exit_fee=$3, pnl=$4,
    closed_at=now(), status='closed', close_reason=$5 WHERE id=$1`, [trade.id, exitPrice, exitFee, pnl, reason]);
  await client.query(`UPDATE paper_portfolio SET cash_balance=cash_balance+$1,
    realized_pnl=realized_pnl+$2, updated_at=now() WHERE id=1`, [proceeds, pnl]);
}

export async function applyPaperDecision(args: {
  decisionId: string;
  symbol: string;
  decision: 'BUY' | 'SELL' | 'HOLD';
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  market: MarketSnapshot | null;
}): Promise<PaperResult> {
  if (!args.market?.price || !Number.isFinite(args.market.price) || args.market.price <= 0) {
    const message = 'Paper order skipped: n8n did not return a valid current market price.';
    await pool.query('UPDATE ai_decisions SET paper_action=$2,paper_message=$3 WHERE id=$1', [args.decisionId, 'skipped', message]);
    return { action: 'skipped', message, portfolio: await portfolioSnapshot() };
  }

  const client = await pool.connect();
  let action = 'hold';
  let message = 'No simulated order for this decision.';
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(73190422)');
    const { rows: accountRows } = await client.query('SELECT * FROM paper_portfolio WHERE id=1 FOR UPDATE');
    const account = accountRows[0];
    if (!account) throw new Error('Paper portfolio is not initialized.');

    const price = args.market.price;
    const high = args.market.high ?? price;
    const low = args.market.low ?? price;
    await client.query(`UPDATE simulated_trades SET last_price=$2 WHERE status='open' AND symbol=$1`, [args.symbol, price]);
    const { rows: symbolPositions } = await client.query("SELECT * FROM simulated_trades WHERE status='open' AND symbol=$1 ORDER BY opened_at FOR UPDATE", [args.symbol]);
    let closedByProtection = false;

    for (const trade of symbolPositions) {
      const stop = trade.stop_loss === null ? null : number(trade.stop_loss);
      const target = trade.take_profit === null ? null : number(trade.take_profit);
      // If both levels occur within a candle and candle ordering is unknown, assume the stop was hit first.
      const stopped = stop !== null && (low <= stop || price <= stop);
      const targeted = target !== null && (high >= target || price >= target);
      if (stopped || targeted) {
        const exit = stopped ? Math.min(price, stop as number) : Math.min(price, target as number);
        await closePosition(client, trade, exit, stopped ? 'stop_loss' : 'take_profit');
        action = stopped ? 'closed_stop_loss' : 'closed_take_profit';
        message = `Simulated position closed by ${stopped ? 'stop loss' : 'take profit'}.`;
        closedByProtection = true;
      }
    }

    const remaining = await client.query("SELECT * FROM simulated_trades WHERE status='open' AND symbol=$1 ORDER BY opened_at LIMIT 1 FOR UPDATE", [args.symbol]);
    const existing = remaining.rows[0];
    if (existing && args.decision === 'SELL') {
      await closePosition(client, existing, price, 'ai_sell');
      action = 'closed_by_signal';
      message = 'SELL decision closed the simulated long position.';
    } else if (args.decision === 'BUY' && !existing && !closedByProtection) {
      const { rows: openRows } = await client.query("SELECT COALESCE(SUM(amount * COALESCE(last_price,entry)),0) AS exposure, COUNT(*)::int AS count FROM simulated_trades WHERE status='open'");
      const exposure = number(openRows[0].exposure);
      const openCount = number(openRows[0].count);
      const cash = number(account.cash_balance);
      const equity = cash + exposure * (1 - paperConfig.feeRate - paperConfig.slippageRate);
      const drawdown = number(account.peak_equity) > 0 ? Math.max(0, (number(account.peak_equity) - equity) / number(account.peak_equity)) : 0;
      const capacity = Math.max(0, equity * paperConfig.maxExposurePct - exposure);
      const stake = Math.min(cash / (1 + paperConfig.feeRate), equity * paperConfig.maxTradePct, capacity);
      if (drawdown >= paperConfig.maxDrawdownPct) {
        action = 'blocked_drawdown';
        message = 'New simulated entries are paused because the maximum drawdown limit was reached.';
      } else if (openCount >= paperConfig.maxOpenTrades) {
        action = 'blocked_positions';
        message = 'New simulated entry blocked by the maximum open positions limit.';
      } else if (stake <= 1) {
        action = 'blocked_balance';
        message = 'Not enough simulated cash or exposure capacity for a new position.';
      } else {
        const fillPrice = price * (1 + paperConfig.slippageRate);
        const qty = stake / fillPrice;
        const entryFee = stake * paperConfig.feeRate;
        const stopLoss = args.stopLoss !== null && args.stopLoss > 0 && args.stopLoss < fillPrice ? args.stopLoss : null;
        const takeProfit = args.takeProfit !== null && args.takeProfit > fillPrice ? args.takeProfit : null;
        await client.query(`INSERT INTO simulated_trades(external_id,decision_id,symbol,side,entry,amount,pnl,
          opened_at,status,entry_fee,stop_loss,take_profit,last_price)
          VALUES($1,$2,$3,'BUY',$4,$5,NULL,now(),'open',$6,$7,$8,$9)`,
          [`paper-${args.decisionId}`, args.decisionId, args.symbol, fillPrice, qty, entryFee, stopLoss, takeProfit, price]);
        await client.query('UPDATE paper_portfolio SET cash_balance=cash_balance-$1, updated_at=now() WHERE id=1', [stake + entryFee]);
        action = 'opened';
        message = 'Simulated long position opened within portfolio risk limits.';
      }
    } else if (args.decision === 'SELL' && !existing && !closedByProtection) {
      action = 'no_position_to_sell';
      message = 'SELL signal recorded; no simulated long position was open. Short positions are disabled.';
    } else if (args.decision === 'BUY' && existing) {
      action = 'already_open';
      message = 'A simulated position for this symbol is already open; no duplicate entry was added.';
    }

    const totals = await client.query(`SELECT p.initial_balance,p.cash_balance,
      COALESCE(SUM(t.amount*COALESCE(t.last_price,t.entry)),0) AS market_value
      FROM paper_portfolio p LEFT JOIN simulated_trades t ON t.status='open' WHERE p.id=1 GROUP BY p.id`);
    const equity = number(totals.rows[0].cash_balance) + number(totals.rows[0].market_value) * (1 - paperConfig.feeRate - paperConfig.slippageRate);
    await client.query('UPDATE paper_portfolio SET peak_equity=GREATEST(peak_equity,$1), updated_at=now() WHERE id=1', [equity]);
    await client.query('UPDATE ai_decisions SET paper_action=$2,paper_message=$3 WHERE id=$1', [args.decisionId, action, message]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { action, message, portfolio: await portfolioSnapshot() };
}

export async function refreshPaperMarket(symbol: string, timeframe: string) {
  const client = await pool.connect();
  let closed = 0;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(73190422)');
    const { rows: positions } = await client.query("SELECT * FROM simulated_trades WHERE status='open' AND symbol=$1 ORDER BY opened_at FOR UPDATE", [symbol]);
    const { rows: latest } = await client.query('SELECT close,candle_at FROM market_candles WHERE symbol=$1 AND timeframe=$2 ORDER BY candle_at DESC LIMIT 1', [symbol,timeframe]);
    if (latest[0]) {
      const mark = number(latest[0].close);
      for (const trade of positions) {
        const { rows: trigger } = await client.query(`SELECT candle_at,high,low,close FROM market_candles
          WHERE symbol=$1 AND timeframe=$2 AND candle_at >= $3
            AND (($4::numeric IS NOT NULL AND low <= $4) OR ($5::numeric IS NOT NULL AND high >= $5))
          ORDER BY candle_at ASC LIMIT 1`, [symbol,timeframe,trade.opened_at,trade.stop_loss,trade.take_profit]);
        if (trigger[0]) {
          const stopHit = trade.stop_loss !== null && number(trigger[0].low) <= number(trade.stop_loss);
          const exit = stopHit ? number(trade.stop_loss) : number(trade.take_profit);
          await closePosition(client,trade,exit,stopHit?'stop_loss':'take_profit');
          closed += 1;
        } else {
          await client.query('UPDATE simulated_trades SET last_price=$2 WHERE id=$1', [trade.id,mark]);
        }
      }
      const { rows: totals } = await client.query(`SELECT p.cash_balance,COALESCE(SUM(t.amount*COALESCE(t.last_price,t.entry)),0) AS market_value
        FROM paper_portfolio p LEFT JOIN simulated_trades t ON t.status='open' WHERE p.id=1 GROUP BY p.id`);
      if (totals[0]) {
        const equity=number(totals[0].cash_balance)+number(totals[0].market_value)*(1-paperConfig.feeRate-paperConfig.slippageRate);
        await client.query('UPDATE paper_portfolio SET peak_equity=GREATEST(peak_equity,$1),updated_at=now() WHERE id=1',[equity]);
      }
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  return closed;
}

function timeframeMillis(timeframe: string) {
  const match = /^(\d+)([mhdw])$/.exec(timeframe);
  if (!match) return null;
  const unit: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  return Number(match[1]) * unit[match[2]];
}

export async function evaluateDecisionOutcomes(symbol: string, timeframe: string, candles: unknown[]) {
  const interval = timeframeMillis(timeframe);
  if (!interval || !Array.isArray(candles) || candles.length < 2) return 0;
  const parsedCandles = candles.map((candle: any) => ({
    time: typeof candle?.date === 'number' ? (candle.date < 10_000_000_000 ? candle.date * 1000 : candle.date) : Date.parse(String(candle?.date ?? '')),
    close: Number(candle?.close)
  })).filter((candle) => Number.isFinite(candle.time) && Number.isFinite(candle.close) && candle.close > 0).sort((a,b) => a.time-b.time);
  if (parsedCandles.length < 2) return 0;
  const oldest = parsedCandles[0].time;
  const newest = parsedCandles.at(-1)!.time;
  const { rows } = await pool.query(`SELECT d.id,d.decision,d.price,d.created_at
    FROM ai_decisions d LEFT JOIN decision_outcomes o ON o.decision_id=d.id
    WHERE d.symbol=$1 AND d.timeframe=$2 AND d.decision IN ('BUY','SELL') AND d.price IS NOT NULL
      AND o.id IS NULL AND d.created_at >= to_timestamp($3) AND d.created_at <= to_timestamp($4)
    ORDER BY d.created_at LIMIT 500`, [symbol, timeframe, (oldest - interval) / 1000, (newest - interval * paperConfig.outcomeHorizonCandles) / 1000]);
  let inserted = 0;
  for (const row of rows) {
    const decisionTime = new Date(row.created_at).getTime();
    const targetTime = decisionTime + interval * paperConfig.outcomeHorizonCandles;
    const future = parsedCandles.find((candle) => candle.time >= targetTime);
    if (!future) continue;
    const reference = number(row.price);
    if (!(reference > 0)) continue;
    const rawReturn = row.decision === 'BUY' ? (future.close - reference) / reference : (reference - future.close) / reference;
    const netReturn = rawReturn - 2 * (paperConfig.feeRate + paperConfig.slippageRate);
    const label = netReturn > 0.001 ? 'FAVORABLE' : netReturn < -0.001 ? 'UNFAVORABLE' : 'FLAT';
    const result = await pool.query(`INSERT INTO decision_outcomes(decision_id,horizon_candles,reference_price,evaluated_price,return_pct,label)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(decision_id) DO NOTHING`,
      [row.id, paperConfig.outcomeHorizonCandles, reference, future.close, netReturn, label]);
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

export async function learningSummary(symbol?: string, timeframe?: string) {
  const { rows } = await pool.query(`SELECT d.symbol,d.timeframe,COUNT(*)::int AS sample_count,
      COUNT(*) FILTER (WHERE o.label='FAVORABLE')::int AS favorable,
      COUNT(*) FILTER (WHERE o.label='UNFAVORABLE')::int AS unfavorable,
      COUNT(*) FILTER (WHERE o.label='FLAT')::int AS flat,
      AVG(o.return_pct)::float AS avg_directional_return
    FROM decision_outcomes o JOIN ai_decisions d ON d.id=o.decision_id
    WHERE ($1::text IS NULL OR d.symbol=$1) AND ($2::text IS NULL OR d.timeframe=$2)
    GROUP BY d.symbol,d.timeframe ORDER BY d.symbol,d.timeframe`, [symbol ?? null, timeframe ?? null]);
  const samples = rows.reduce((sum, row) => sum + number(row.sample_count), 0);
  return {
    method: 'forward_outcomes',
    horizonCandles: paperConfig.outcomeHorizonCandles,
    minimumSampleForInterpretation: 30,
    sufficientSample: samples >= 30,
    totalEvaluatedDecisions: samples,
    byMarket: rows.map((row) => ({ ...row, sampleCount: number(row.sample_count), favorable: number(row.favorable), unfavorable: number(row.unfavorable), flat: number(row.flat), avgDirectionalReturn: row.avg_directional_return === null ? null : number(row.avg_directional_return), sampleSufficient: number(row.sample_count) >= 30 }))
  };
}
