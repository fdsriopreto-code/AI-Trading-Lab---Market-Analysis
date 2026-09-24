import { z } from 'zod';
import { pool } from './db.js';
import { collectMarketHistory, readMarketContext } from './freqtrade.js';
import { applyPaperDecision, evaluateDecisionOutcomes, learningSummary, paperConfig, portfolioSnapshot, refreshPaperMarket, type MarketSnapshot } from './paperTrading.js';

const decisionName = z.enum(['BUY','SELL','HOLD']);
const AIResponse = z.object({
  decision: decisionName, confidence: z.number().min(0).max(1),
  entry: z.number().finite().nullable(), stop_loss: z.number().finite().nullable(), take_profit: z.number().finite().nullable(),
  reason: z.string(), market: z.object({ price: z.number().positive().nullable() }).passthrough().nullable().optional(), candles: z.array(z.unknown()).optional()
}).strict();
const defaults = {
  symbols: paperConfig.symbols,
  timeframe: paperConfig.autoTimeframe,
  intervalMinutes: 240,
  historyDays: 90,
  enabled: paperConfig.autoAnalyze
};

export async function initializeAnalysisQueue() {
  await pool.query(`INSERT INTO analysis_settings(id,enabled,symbols,timeframe,interval_minutes,history_days)
    VALUES(1,$1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`, [defaults.enabled, defaults.symbols, defaults.timeframe, defaults.intervalMinutes, defaults.historyDays]);
  await pool.query("UPDATE analysis_jobs SET status='pending',locked_at=NULL,error='Worker restarted while processing; job returned to queue.' WHERE status='processing' AND locked_at < now()-interval '5 minutes'");
}

export async function getAnalysisSettings() {
  const { rows } = await pool.query('SELECT * FROM analysis_settings WHERE id=1');
  const row = rows[0];
  return { enabled: row.enabled, symbols: row.symbols, timeframe: row.timeframe, intervalMinutes: Number(row.interval_minutes), historyDays: Number(row.history_days), lastEnqueuedAt: row.last_enqueued_at ? new Date(row.last_enqueued_at).toISOString() : null, updatedAt: new Date(row.updated_at).toISOString() };
}

export async function saveAnalysisSettings(input: { enabled: boolean; symbols: string[]; timeframe: string; intervalMinutes: number; historyDays: number }) {
  if (input.symbols.length < 1 || input.symbols.length > 20) throw new Error('Choose between 1 and 20 markets.');
  if (new Set(input.symbols).size !== input.symbols.length || input.symbols.some((symbol) => !/^[A-Z0-9]+\/[A-Z0-9]+$/.test(symbol))) throw new Error('Market symbols must be unique pairs such as BTC/USDT.');
  const { rows } = await pool.query(`UPDATE analysis_settings SET enabled=$1,symbols=$2,timeframe=$3,interval_minutes=$4,history_days=$5,updated_at=now()
    WHERE id=1 RETURNING *`, [input.enabled, input.symbols, input.timeframe, input.intervalMinutes, input.historyDays]);
  const row = rows[0];
  return { enabled: row.enabled, symbols: row.symbols, timeframe: row.timeframe, intervalMinutes: Number(row.interval_minutes), historyDays: Number(row.history_days), lastEnqueuedAt: row.last_enqueued_at ? new Date(row.last_enqueued_at).toISOString() : null, updatedAt: new Date(row.updated_at).toISOString() };
}

export async function enqueueAnalysis(symbols: string[], timeframe: string, historyDays: number, source: 'manual'|'schedule') {
  const created: { id: string; symbol: string; timeframe: string; status: string }[] = [];
  for (const symbol of symbols) {
    const { rows } = await pool.query(`INSERT INTO analysis_jobs(symbol,timeframe,history_days,source)
      VALUES($1,$2,$3,$4) ON CONFLICT(symbol,timeframe) WHERE status IN ('pending','processing') DO NOTHING
      RETURNING id,symbol,timeframe,status`, [symbol, timeframe, historyDays, source]);
    if (rows[0]) created.push({ id: String(rows[0].id), symbol: rows[0].symbol, timeframe: rows[0].timeframe, status: rows[0].status });
  }
  return created;
}

export async function queueSnapshot(limit = 30) {
  const [counts, jobs, settings] = await Promise.all([
    pool.query("SELECT status,COUNT(*)::int AS count FROM analysis_jobs WHERE created_at > now()-interval '30 days' GROUP BY status"),
    pool.query(`SELECT j.id::text,j.symbol,j.timeframe,j.history_days,j.source,j.status,j.attempts,j.error,j.created_at,j.started_at,j.completed_at,j.decision_id::text,
        d.decision,d.confidence,d.price,d.reason,d.paper_action
      FROM analysis_jobs j LEFT JOIN ai_decisions d ON d.id=j.decision_id ORDER BY j.created_at DESC LIMIT $1`, [limit]),
    getAnalysisSettings()
  ]);
  return { counts: Object.fromEntries(['pending','processing','completed','failed'].map((status) => [status, Number(counts.rows.find((row) => row.status === status)?.count ?? 0)])), settings, jobs: jobs.rows.map((row) => ({ ...row, historyDays: Number(row.history_days), attempts: Number(row.attempts), confidence: row.confidence === null ? null : Number(row.confidence), price: row.price === null ? null : Number(row.price), createdAt: new Date(row.created_at).toISOString(), startedAt: row.started_at ? new Date(row.started_at).toISOString() : null, completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null })) };
}

export async function getJob(jobId: string) {
  const { rows } = await pool.query(`SELECT j.id::text,j.symbol,j.timeframe,j.history_days,j.source,j.status,j.attempts,j.error,j.created_at,j.started_at,j.completed_at,j.decision_id::text,
      d.decision,d.confidence,d.price,d.entry,d.stop_loss,d.take_profit,d.reason,d.paper_action,d.paper_message
    FROM analysis_jobs j LEFT JOIN ai_decisions d ON d.id=j.decision_id WHERE j.id=$1`, [jobId]);
  if (!rows[0]) return null;
  const row = rows[0];
  return { ...row, historyDays: Number(row.history_days), attempts: Number(row.attempts), confidence: row.confidence === null ? null : Number(row.confidence), price: row.price === null ? null : Number(row.price), createdAt: new Date(row.created_at).toISOString(), startedAt: row.started_at ? new Date(row.started_at).toISOString() : null, completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null };
}

async function claimJob() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query("SELECT id FROM analysis_jobs WHERE status='pending' AND run_after<=now() ORDER BY run_after,created_at FOR UPDATE SKIP LOCKED LIMIT 1");
    if (!rows[0]) { await client.query('COMMIT'); return null; }
    const { rows: claimed } = await client.query("UPDATE analysis_jobs SET status='processing',attempts=attempts+1,locked_at=now(),started_at=COALESCE(started_at,now()),error=NULL WHERE id=$1 RETURNING *", [rows[0].id]);
    await client.query('COMMIT');
    return claimed[0];
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function executeJob(job: any) {
  const previous = await pool.query('SELECT * FROM ai_decisions WHERE job_id=$1', [job.id]);
  if (previous.rows[0]) {
    const row = previous.rows[0];
    if (!row.paper_action) {
      const market = row.indicators ?? {};
      const candles = row.candles ?? [];
      await evaluateDecisionOutcomes(job.symbol,job.timeframe,candles);
      await applyPaperDecision({ decisionId:String(row.id),symbol:job.symbol,decision:row.decision,entry:row.entry === null ? null : Number(row.entry),stopLoss:row.stop_loss === null ? null : Number(row.stop_loss),takeProfit:row.take_profit === null ? null : Number(row.take_profit),market });
    }
    await pool.query("UPDATE analysis_jobs SET status='completed',locked_at=NULL,decision_id=$2,completed_at=now() WHERE id=$1", [job.id,row.id]);
    return;
  }
  const n8nUrl = process.env.N8N_ANALYZE_WEBHOOK_URL;
  if (!n8nUrl) throw new Error('N8N_ANALYZE_WEBHOOK_URL is not configured.');
  const collected = await collectMarketHistory(job.symbol, job.timeframe, Number(job.history_days));
  const exits = await refreshPaperMarket(job.symbol,job.timeframe);
  if (exits) console.info(JSON.stringify({ event:'paper_protective_exit',symbol:job.symbol,timeframe:job.timeframe,closed:exits }));
  const context = await readMarketContext(job.symbol, job.timeframe, Number(job.history_days));
  const [portfolio, performance] = await Promise.all([portfolioSnapshot(), learningSummary(job.symbol, job.timeframe)]);
  const headers: Record<string,string> = { 'content-type':'application/json' };
  if (process.env.N8N_WEBHOOK_TOKEN) headers.authorization = `Bearer ${process.env.N8N_WEBHOOK_TOKEN}`;
  const response = await fetch(n8nUrl, { method:'POST', headers,
    body: JSON.stringify({ symbol:job.symbol,timeframe:job.timeframe,mode:'DRY_RUN',paper_context:{portfolio,performance},market_context:context }),
    signal: AbortSignal.timeout(105_000) });
  if (!response.ok) throw new Error(`n8n returned HTTP ${response.status}`);
  const raw = await response.json();
  if (raw?.ok === false || raw?.response?.error) {
    throw new Error(raw?.response?.error?.message ?? raw?.error?.message ?? 'n8n returned an AI workflow error.');
  }
  // n8n Respond to Webhook commonly returns { statusCode, response: {...decision} }.
  const result = AIResponse.parse(raw?.response ?? raw);
  const market = (result.market ?? { ...context.current, historicalSummary: context.historicalSummary }) as MarketSnapshot;
  const candles = result.candles?.length ? result.candles : context.candles;
  const marketWithContext = { ...market, historicalSummary: context.historicalSummary, historyStoredCandles: collected.stored };
  const { rows } = await pool.query(`INSERT INTO ai_decisions(job_id,symbol,timeframe,decision,confidence,price,entry,stop_loss,take_profit,reason,indicators,candles,raw_response)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb) RETURNING id`,
    [job.id,job.symbol,job.timeframe,result.decision,result.confidence,market.price,result.entry,result.stop_loss,result.take_profit,result.reason,
      JSON.stringify(marketWithContext),JSON.stringify(candles),JSON.stringify(raw)]);
  const decisionId = String(rows[0].id);
  const { rows: outcomeRows } = await pool.query(`SELECT candle_at AS date,close FROM market_candles WHERE symbol=$1 AND timeframe=$2
    ORDER BY candle_at DESC LIMIT 30000`, [job.symbol,job.timeframe]);
  await evaluateDecisionOutcomes(job.symbol,job.timeframe,outcomeRows.reverse());
  const paper = await applyPaperDecision({ decisionId,symbol:job.symbol,decision:result.decision,entry:result.entry,stopLoss:result.stop_loss,takeProfit:result.take_profit,market:marketWithContext });
  await pool.query("UPDATE analysis_jobs SET status='completed',locked_at=NULL,decision_id=$2,completed_at=now() WHERE id=$1", [job.id,decisionId]);
  return paper;
}

export async function processNextAnalysisJob() {
  const job = await claimJob();
  if (!job) return false;
  try { await executeJob(job); }
  catch (error) {
    const message = error instanceof Error ? error.message.slice(0,1000) : 'Unknown analysis job error';
    const retryable = Number(job.attempts) < 3;
    await pool.query(`UPDATE analysis_jobs SET status=$2,locked_at=NULL,error=$3,run_after=now()+make_interval(secs => $4::int),completed_at=CASE WHEN $2='failed' THEN now() ELSE NULL END WHERE id=$1`,
      [job.id,retryable?'pending':'failed',message,retryable ? 30 * 2 ** (Number(job.attempts)-1) : 0]);
    console.error(JSON.stringify({ event:'analysis_job_failed',jobId:String(job.id),symbol:job.symbol,timeframe:job.timeframe,attempt:Number(job.attempts),retryable,message }));
  }
  return true;
}

export async function enqueueScheduledAnalysis() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(73190423) AS locked');
    if (!lock.rows[0].locked) { await client.query('COMMIT'); return 0; }
    const { rows } = await client.query('SELECT * FROM analysis_settings WHERE id=1 FOR UPDATE');
    const settings = rows[0];
    if (!settings?.enabled || (settings.last_enqueued_at && Date.now()-new Date(settings.last_enqueued_at).getTime() < Number(settings.interval_minutes)*60_000)) { await client.query('COMMIT'); return 0; }
    let enqueued = 0;
    for (const symbol of settings.symbols) {
      const result = await client.query(`INSERT INTO analysis_jobs(symbol,timeframe,history_days,source) VALUES($1,$2,$3,'schedule')
        ON CONFLICT(symbol,timeframe) WHERE status IN ('pending','processing') DO NOTHING`, [symbol,settings.timeframe,settings.history_days]);
      enqueued += result.rowCount ?? 0;
    }
    await client.query('UPDATE analysis_settings SET last_enqueued_at=now(),updated_at=now() WHERE id=1');
    await client.query('COMMIT');
    return enqueued;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
