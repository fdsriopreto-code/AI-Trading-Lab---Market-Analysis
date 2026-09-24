import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { pool } from './db.js';
import { initializePaperPortfolio, learningSummary, paperConfig, portfolioSnapshot } from './paperTrading.js';
import { enqueueAnalysis, enqueueScheduledAnalysis, getAnalysisSettings, getJob, initializeAnalysisQueue, processNextAnalysisJob, queueSnapshot, saveAnalysisSettings } from './analysisQueue.js';
import { freqtradeHealth, freqtradeMarkets } from './freqtrade.js';

const app = Fastify({ logger: true, bodyLimit: 1_000_000 });
await app.register(cors, { origin: process.env.FRONTEND_ORIGIN ? [process.env.FRONTEND_ORIGIN] : false });

// The root Dockerfile can serve the dashboard and API from one EasyPanel App service.
// The Compose deployment keeps its separate Nginx frontend and leaves this disabled.
if (process.env.SERVE_FRONTEND === 'true') {
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/app.css', ['app.css', 'text/css; charset=utf-8']],
    ['/config.js', ['config.js', 'text/javascript; charset=utf-8']]
  ] as const);
  for (const [route, [filename, contentType]] of assets) {
    app.get(route, async (_request, reply) => reply.type(contentType).header('cache-control', 'no-cache').send(
      await readFile(new URL(`../public/${filename}`, import.meta.url))
    ));
  }
}

const decisionName = z.enum(['BUY', 'SELL', 'HOLD']);
const DecisionResponse = z.object({
  id: z.string(), symbol: z.string(), timeframe: z.string(), decision: decisionName,
  confidence: z.number().min(0).max(1).nullable(), price: z.number().nullable(),
  entry: z.number().nullable(), stopLoss: z.number().nullable(), takeProfit: z.number().nullable(),
  reason: z.string(), indicators: z.record(z.unknown()), candles: z.array(z.unknown()), createdAt: z.string(),
  paperAction: z.string().nullable().optional(), paperMessage: z.string().nullable().optional()
});
const TradeResponse = z.object({ id: z.string(), externalId: z.string().nullable(), symbol: z.string(), side: z.enum(['BUY','SELL']), entry: z.number().nullable(), exit: z.number().nullable(), amount: z.number().nullable(), pnl: z.number().nullable(), openedAt: z.string().nullable(), closedAt: z.string().nullable(), status: z.enum(['open','closed']), createdAt: z.string(), decisionId: z.string().nullable().optional(), entryFee: z.number().optional(), exitFee: z.number().optional(), stopLoss: z.number().nullable().optional(), takeProfit: z.number().nullable().optional(), lastPrice: z.number().nullable().optional(), closeReason: z.string().nullable().optional() });
const DashboardResponse = z.object({ mode: z.literal('DRY_RUN'), latestDecision: DecisionResponse.nullable(), openTrades: z.number().int().nonnegative(), market: z.object({ symbol: z.string(), price: z.number().nullable(), change24h: z.number().nullable() }).nullable(), balance: z.object({ total: z.number().nullable(), currency: z.string() }).nullable(), portfolio: z.record(z.unknown()) });
const AnalyzeRequest = z.object({
  symbol: z.string().regex(/^[A-Z0-9]+\/[A-Z0-9]+$/, 'Expected a pair such as BTC/USDT'),
  timeframe: z.string().regex(/^\d+[mhdw]$/, 'Expected timeframe such as 5m')
}).strict();
function nullableNumber(value: unknown): number | null { return value === null || value === undefined ? null : Number(value); }
function mapDecision(row: any) {
  return DecisionResponse.parse({ id: String(row.id), symbol: row.symbol, timeframe: row.timeframe, decision: row.decision,
    confidence: nullableNumber(row.confidence), price: nullableNumber(row.price), entry: nullableNumber(row.entry),
    stopLoss: nullableNumber(row.stop_loss), takeProfit: nullableNumber(row.take_profit), reason: row.reason,
    indicators: row.indicators, candles: row.candles, createdAt: new Date(row.created_at).toISOString(), paperAction: row.paper_action ?? null, paperMessage: row.paper_message ?? null });
}
function mapTrade(row: any) {
  return TradeResponse.parse({ id: String(row.id), externalId: row.external_id, symbol: row.symbol, side: row.side,
    entry: nullableNumber(row.entry), exit: nullableNumber(row.exit), amount: nullableNumber(row.amount), pnl: nullableNumber(row.pnl),
    openedAt: row.opened_at ? new Date(row.opened_at).toISOString() : null,
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null, status: row.status, createdAt: new Date(row.created_at).toISOString(),
    decisionId: row.decision_id === null || row.decision_id === undefined ? null : String(row.decision_id), entryFee: nullableNumber(row.entry_fee), exitFee: nullableNumber(row.exit_fee),
    stopLoss: nullableNumber(row.stop_loss), takeProfit: nullableNumber(row.take_profit), lastPrice: nullableNumber(row.last_price), closeReason: row.close_reason ?? null });
}
app.setErrorHandler((error, _request, reply) => {
  if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request', details: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) });
  app.log.error({ err: error }, 'Unhandled API error');
  return reply.code(500).send({ error: 'Internal server error' });
});

app.get('/health', async (_request, reply) => {
  try { await pool.query('SELECT 1'); return { api: 'ok', database: 'ok', freqtrade: await freqtradeHealth() }; }
  catch (error) { app.log.error({ err: error }, 'PostgreSQL health check failed'); return reply.code(503).send({ api: 'ok', database: 'unavailable' }); }
});
app.get('/api/config', async () => {
  const [settings, freqtrade] = await Promise.all([getAnalysisSettings(),freqtradeHealth()]);
  return { symbols: settings.symbols, defaultSymbols: paperConfig.symbols, timeframes: ['5m','15m','30m','1h','4h','1d'], historyDayOptions: [30,60,90,180], mode: 'DRY_RUN', automation: settings, paperSettings: {
    initialBalance: paperConfig.startingBalance, maxTradePct: paperConfig.maxTradePct, maxExposurePct: paperConfig.maxExposurePct,
    maxOpenTrades: paperConfig.maxOpenTrades, feeRate: paperConfig.feeRate, slippageRate: paperConfig.slippageRate, maxDrawdownPct: paperConfig.maxDrawdownPct
  }, services: { freqtrade, n8n: process.env.N8N_ANALYZE_WEBHOOK_URL ? 'configured' : 'not_configured' } };
});
app.get('/api/dashboard', async () => {
  const [{ rows: latest }, { rows: latestMarket }, portfolio] = await Promise.all([
    pool.query('SELECT * FROM ai_decisions ORDER BY created_at DESC LIMIT 1'),
    pool.query('SELECT symbol,close,candle_at FROM market_candles ORDER BY candle_at DESC LIMIT 1'),
    portfolioSnapshot()
  ]);
  return DashboardResponse.parse({ mode: 'DRY_RUN', latestDecision: latest[0] ? mapDecision(latest[0]) : null,
    openTrades: portfolio.openPositions, market: latestMarket[0] ? { symbol: latestMarket[0].symbol, price: nullableNumber(latestMarket[0].close), change24h: null } : null,
    balance: { total: portfolio.equity, currency: portfolio.currency }, portfolio });
});
app.get('/api/paper/portfolio', async () => portfolioSnapshot());
app.get('/api/paper/learning', async (request) => {
  const query = z.object({ symbol: z.string().max(30).optional(), timeframe: z.string().max(10).optional() }).parse(request.query);
  return learningSummary(query.symbol, query.timeframe);
});
app.get('/api/paper/learning/dataset', async (request) => {
  const query = z.object({ symbol: z.string().max(30).optional(), timeframe: z.string().max(10).optional(), limit: z.coerce.number().int().min(1).max(5000).default(1000) }).parse(request.query);
  const { rows } = await pool.query(`SELECT d.id::text AS decision_id,d.symbol,d.timeframe,d.decision,d.confidence,
      d.price AS reference_price,d.indicators AS features,o.evaluated_price,o.return_pct,o.label,o.horizon_candles,o.evaluated_at
    FROM decision_outcomes o JOIN ai_decisions d ON d.id=o.decision_id
    WHERE ($1::text IS NULL OR d.symbol=$1) AND ($2::text IS NULL OR d.timeframe=$2)
    ORDER BY o.evaluated_at DESC LIMIT $3`, [query.symbol ?? null, query.timeframe ?? null, query.limit]);
  return { featureSet: 'ai_decisions.indicators', target: 'decision_outcomes.label', caution: 'Exploratory historical labels; validate out-of-sample before training or deployment.', samples: rows };
});
app.get('/api/markets', async () => {
  const settings=await getAnalysisSettings();
  try { return { symbols: [...new Set([...await freqtradeMarkets(settings.timeframe),...paperConfig.symbols,...settings.symbols])], source: 'FREQTRADE_AVAILABLE_PAIRS' }; }
  catch { return { symbols: [...new Set([...paperConfig.symbols,...settings.symbols])], source: 'PAPER_DEFAULTS' }; }
});
app.get('/api/automation', async () => ({ ...(await queueSnapshot()), services: { freqtrade: await freqtradeHealth(), ai: process.env.N8N_ANALYZE_WEBHOOK_URL ? 'configured' : 'not_configured' } }));
app.put('/api/automation/settings', async (request) => {
  const input = z.object({ enabled: z.boolean(), symbols: z.array(z.string()).min(1).max(20), timeframe: z.string().regex(/^\d+[mhdw]$/), intervalMinutes: z.number().int().min(30).max(10080), historyDays: z.number().int().min(7).max(180) }).strict().parse(request.body);
  return saveAnalysisSettings(input);
});
app.get('/api/analysis/jobs', async (request) => {
  const { limit = 30 } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query);
  return queueSnapshot(limit);
});
app.get('/api/analysis/jobs/:id', async (request, reply) => {
  const { id } = z.object({ id: z.string().regex(/^\d+$/) }).parse(request.params);
  const job = await getJob(id);
  return job ?? reply.code(404).send({ error: 'Analysis job not found.' });
});
app.post('/api/automation/run', async (request, reply) => {
  const settings = await getAnalysisSettings();
  const body = z.object({ symbols: z.array(z.string().regex(/^[A-Z0-9]+\/[A-Z0-9]+$/)).min(1).max(20).optional(), timeframe: z.string().regex(/^\d+[mhdw]$/).optional(), historyDays: z.number().int().min(7).max(180).optional() }).strict().parse(request.body ?? {});
  const symbols = body.symbols ?? settings.symbols;
  const jobs = await enqueueAnalysis(symbols,body.timeframe ?? settings.timeframe,body.historyDays ?? settings.historyDays,'manual');
  return reply.code(202).send({ accepted: jobs.length, skippedAsAlreadyQueued: symbols.length-jobs.length, jobs });
});
app.get('/api/ai/decisions/latest', async () => {
  const { rows } = await pool.query('SELECT * FROM ai_decisions ORDER BY created_at DESC LIMIT 1');
  return rows[0] ? mapDecision(rows[0]) : null;
});
app.get('/api/ai/decisions', async (request) => {
  const query = z.object({ symbol: z.string().max(30).optional(), decision: decisionName.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query);
  const { rows } = await pool.query('SELECT * FROM ai_decisions WHERE ($1::text IS NULL OR symbol=$1) AND ($2::text IS NULL OR decision=$2) ORDER BY created_at DESC LIMIT $3', [query.symbol ?? null, query.decision ?? null, query.limit]);
  return rows.map(mapDecision);
});
app.get('/api/trades', async () => (await pool.query('SELECT * FROM simulated_trades ORDER BY created_at DESC LIMIT 200')).rows.map(mapTrade));
app.get('/api/market/:symbol', async (request, reply) => {
  const { symbol } = z.object({ symbol: z.string().regex(/^[A-Za-z0-9/-]{3,30}$/) }).parse(request.params);
  const { rows } = await pool.query('SELECT symbol,close,candle_at FROM market_candles WHERE symbol=$1 ORDER BY candle_at DESC LIMIT 1', [symbol.replace('-', '/')]);
  if (!rows[0]) return reply.code(404).send({ error: 'No market snapshot has been recorded for this symbol yet.', symbol });
  return { symbol: rows[0].symbol, price: nullableNumber(rows[0].close), recordedAt: new Date(rows[0].candle_at).toISOString(), source: 'FREQTRADE_POSTGRES_HISTORY' };
});
app.get('/api/market/:symbol/candles', async (request, reply) => {
  const { symbol } = z.object({ symbol: z.string().regex(/^[A-Za-z0-9/-]{3,30}$/) }).parse(request.params);
  const { timeframe = '5m', limit = 100 } = z.object({ timeframe: z.string().regex(/^\d+[mhdw]$/).default('5m'), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(request.query);
  const { rows } = await pool.query('SELECT candle_at,open,high,low,close,volume,indicators FROM market_candles WHERE symbol=$1 AND timeframe=$2 ORDER BY candle_at DESC LIMIT $3', [symbol.replace('-', '/'), timeframe, limit]);
  if (!rows[0]) return reply.code(404).send({ error: 'No candle snapshot has been recorded for this market yet.' });
  return { symbol: symbol.replace('-', '/'), timeframe, candles: rows.reverse().map((row) => ({ date: new Date(row.candle_at).toISOString(), open: nullableNumber(row.open), high: nullableNumber(row.high), low: nullableNumber(row.low), close: nullableNumber(row.close), volume: nullableNumber(row.volume), ...(row.indicators ?? {}) })), recordedAt: new Date(rows.at(-1).candle_at).toISOString(), source: 'FREQTRADE_POSTGRES_HISTORY' };
});

app.post('/api/ai/analyze', async (request, reply) => {
  const input = AnalyzeRequest.parse(request.body);
  const settings = await getAnalysisSettings();
  const jobs = await enqueueAnalysis([input.symbol],input.timeframe,settings.historyDays,'manual');
  return reply.code(202).send({ accepted: jobs.length, jobs });
});

app.post('/api/ai/analyze/all', async (request, reply) => {
  const input = z.object({ timeframe: z.string().regex(/^\d+[mhdw]$/) }).strict().parse(request.body);
  const settings = await getAnalysisSettings();
  const jobs = await enqueueAnalysis(settings.symbols,input.timeframe,settings.historyDays,'manual');
  return reply.code(202).send({ accepted: jobs.length, skippedAsAlreadyQueued: settings.symbols.length-jobs.length, jobs });
});

const port = Number(process.env.PORT ?? 3000);
await initializePaperPortfolio();
await initializeAnalysisQueue();
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });
const queueTimers: NodeJS.Timeout[] = [];
const workerCount = Math.max(1,Math.min(4,Number.parseInt(process.env.ANALYSIS_WORKER_CONCURRENCY ?? '2',10)||2));
for (let worker=0;worker<workerCount;worker++) {
  let running=false;
  const timer=setInterval(async()=>{
    if(running)return;
    running=true;
    try{await processNextAnalysisJob();}
    catch(error){app.log.error({worker,errorType:error instanceof Error?error.name:'UnknownError'},'Analysis queue worker tick failed');}
    finally{running=false;}
  },1_500);
  timer.unref();queueTimers.push(timer);
}
const scheduleTimer = setInterval(async () => {
  try {
    const enqueued = await enqueueScheduledAnalysis();
    if (enqueued) app.log.info({ enqueued }, 'Scheduled market analysis jobs added to queue');
  } catch (error) { app.log.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Analysis scheduler tick failed'); }
}, 15_000);
scheduleTimer.unref();
app.log.info({ markets: paperConfig.symbols.length, workers: workerCount, worker: 'postgres-backed' }, 'Persistent analysis queue started');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { for(const timer of [...queueTimers,scheduleTimer])clearInterval(timer);await app.close(); await pool.end(); process.exit(0); });
