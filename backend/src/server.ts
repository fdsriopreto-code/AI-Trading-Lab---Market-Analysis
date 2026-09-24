import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { pool } from './db.js';
import { applyPaperDecision, evaluateDecisionOutcomes, initializePaperPortfolio, learningSummary, paperConfig, portfolioSnapshot, type MarketSnapshot } from './paperTrading.js';

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
const N8nResponse = z.object({
  decision: decisionName,
  confidence: z.number().min(0).max(1),
  entry: z.number().finite().nullable(),
  stop_loss: z.number().finite().nullable(),
  take_profit: z.number().finite().nullable(),
  reason: z.string(),
  market: z.object({ price: z.number().positive().nullable(), high: z.number().nullable().optional(), low: z.number().nullable().optional(), date: z.union([z.string(), z.number()]).nullable().optional() }).passthrough().nullable().optional(),
  candles: z.array(z.unknown()).optional()
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
  try { await pool.query('SELECT 1'); return { api: 'ok', database: 'ok' }; }
  catch (error) { app.log.error({ err: error }, 'PostgreSQL health check failed'); return reply.code(503).send({ api: 'ok', database: 'unavailable' }); }
});
app.get('/api/config', async () => ({ symbols: paperConfig.symbols, timeframes: ['5m','15m','1h','4h'], mode: 'DRY_RUN', paperSettings: {
  initialBalance: paperConfig.startingBalance, maxTradePct: paperConfig.maxTradePct, maxExposurePct: paperConfig.maxExposurePct,
  maxOpenTrades: paperConfig.maxOpenTrades, feeRate: paperConfig.feeRate, slippageRate: paperConfig.slippageRate, maxDrawdownPct: paperConfig.maxDrawdownPct,
  autoAnalyze: paperConfig.autoAnalyze, autoTimeframe: paperConfig.autoTimeframe, autoIntervalMinutes: paperConfig.autoIntervalMinutes
} }));
app.get('/api/dashboard', async () => {
  const [{ rows: latest }, portfolio] = await Promise.all([
    pool.query('SELECT * FROM ai_decisions ORDER BY created_at DESC LIMIT 1'), portfolioSnapshot()
  ]);
  return DashboardResponse.parse({ mode: 'DRY_RUN', latestDecision: latest[0] ? mapDecision(latest[0]) : null,
    openTrades: portfolio.openPositions, market: latest[0] ? { symbol: latest[0].symbol, price: nullableNumber(latest[0].price), change24h: null } : null,
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
app.get('/api/markets', async () => ({ symbols: paperConfig.symbols, source: 'PAPER_ALLOWLIST' }));
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
  const { rows } = await pool.query('SELECT symbol,price,created_at FROM ai_decisions WHERE symbol=$1 AND price IS NOT NULL ORDER BY created_at DESC LIMIT 1', [symbol.replace('-', '/')]);
  if (!rows[0]) return reply.code(404).send({ error: 'No market snapshot has been recorded for this symbol yet.', symbol });
  return { symbol: rows[0].symbol, price: nullableNumber(rows[0].price), recordedAt: new Date(rows[0].created_at).toISOString(), source: 'LAST_ANALYSIS_SNAPSHOT' };
});
app.get('/api/market/:symbol/candles', async (request, reply) => {
  const { symbol } = z.object({ symbol: z.string().regex(/^[A-Za-z0-9/-]{3,30}$/) }).parse(request.params);
  const { timeframe = '5m', limit = 100 } = z.object({ timeframe: z.string().regex(/^\d+[mhdw]$/).default('5m'), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(request.query);
  const { rows } = await pool.query('SELECT candles,created_at FROM ai_decisions WHERE symbol=$1 AND timeframe=$2 AND jsonb_array_length(candles)>0 ORDER BY created_at DESC LIMIT 1', [symbol.replace('-', '/'), timeframe]);
  if (!rows[0]) return reply.code(404).send({ error: 'No candle snapshot has been recorded for this market yet.' });
  return { symbol: symbol.replace('-', '/'), timeframe, candles: (rows[0].candles as unknown[]).slice(-limit), recordedAt: new Date(rows[0].created_at).toISOString(), source: 'LAST_ANALYSIS_SNAPSHOT' };
});

async function runAnalysis(input: z.infer<typeof AnalyzeRequest>) {
  if (!paperConfig.symbols.includes(input.symbol)) throw new Error(`Symbol ${input.symbol} is not enabled in PAPER_SYMBOLS.`);
  const webhook = process.env.N8N_ANALYZE_WEBHOOK_URL;
  if (!webhook) throw new Error('Analysis workflow is not configured.');
  const [portfolio, performance] = await Promise.all([portfolioSnapshot(), learningSummary(input.symbol, input.timeframe)]);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (process.env.N8N_WEBHOOK_TOKEN) headers.authorization = `Bearer ${process.env.N8N_WEBHOOK_TOKEN}`;
  const response = await fetch(webhook, { method: 'POST', headers,
    body: JSON.stringify({ ...input, mode: 'DRY_RUN', paper_context: { portfolio, performance } }), signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`n8n returned HTTP ${response.status}`);
  const raw: unknown = await response.json();
  const result = N8nResponse.parse(raw);
  const market = result.market as MarketSnapshot | null | undefined;
  const price = market?.price ?? null;
  const { rows } = await pool.query(`INSERT INTO ai_decisions(symbol,timeframe,decision,confidence,price,entry,stop_loss,take_profit,reason,indicators,candles,raw_response)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb) RETURNING *`,
    [input.symbol,input.timeframe,result.decision,result.confidence,price,result.entry,result.stop_loss,result.take_profit,result.reason,
      JSON.stringify(market ?? {}), JSON.stringify(result.candles ?? []), JSON.stringify(raw)]);
  const inserted = rows[0];
  await evaluateDecisionOutcomes(input.symbol, input.timeframe, result.candles ?? []);
  const paper = await applyPaperDecision({ decisionId: String(inserted.id), symbol: input.symbol, decision: result.decision,
    entry: result.entry, stopLoss: result.stop_loss, takeProfit: result.take_profit, market: market ?? null });
  const { rows: saved } = await pool.query('SELECT * FROM ai_decisions WHERE id=$1', [inserted.id]);
  return { ...mapDecision(saved[0]), paper: { action: paper.action, message: paper.message, portfolio: paper.portfolio } };
}

app.post('/api/ai/analyze', async (request, reply) => {
  const input = AnalyzeRequest.parse(request.body);
  try { return reply.code(201).send(await runAnalysis(input)); }
  catch (error) {
    const failure = error instanceof z.ZodError
      ? { type: 'InvalidN8nResponse', issues: error.issues.map(({ path, message }) => ({ path, message })) }
      : { type: error instanceof Error ? error.name : 'UnknownError', httpStatus: error instanceof Error && /^n8n returned HTTP \d+$/.test(error.message) ? error.message.slice(-3) : undefined };
    app.log.error({ failure, symbol: input.symbol, timeframe: input.timeframe }, 'n8n analysis failed or returned an invalid response');
    return reply.code(error instanceof Error && error.message.includes('not enabled') ? 400 : error instanceof Error && error.message.includes('not configured') ? 503 : 502)
      .send({ error: error instanceof Error && error.message.includes('not enabled') ? error.message : 'Analysis workflow failed or returned an invalid response' });
  }
});

app.post('/api/ai/analyze/all', async (request, reply) => {
  const input = z.object({ timeframe: z.string().regex(/^\d+[mhdw]$/) }).strict().parse(request.body);
  if (!paperConfig.symbols.length) return reply.code(503).send({ error: 'No paper markets are configured.' });
  const results: { symbol: string; ok: boolean; result?: unknown; error?: string }[] = [];
  for (const symbol of paperConfig.symbols) {
    try { results.push({ symbol, ok: true, result: await runAnalysis({ symbol, timeframe: input.timeframe }) }); }
    catch { results.push({ symbol, ok: false, error: 'Analysis failed for this market.' }); }
  }
  return reply.code(results.some((result) => result.ok) ? 200 : 502).send({ mode: 'DRY_RUN', results, portfolio: await portfolioSnapshot() });
});

const port = Number(process.env.PORT ?? 3000);
await initializePaperPortfolio();
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });
if (paperConfig.autoAnalyze && process.env.N8N_ANALYZE_WEBHOOK_URL) {
  let scanInProgress = false;
  const timer = setInterval(async () => {
    if (scanInProgress) return;
    scanInProgress = true;
    try {
      const outcomes: { symbol: string; ok: boolean }[] = [];
      for (const symbol of paperConfig.symbols) {
        try { await runAnalysis({ symbol, timeframe: paperConfig.autoTimeframe }); outcomes.push({ symbol, ok: true }); }
        catch (error) { app.log.warn({ symbol, errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Scheduled paper analysis failed'); outcomes.push({ symbol, ok: false }); }
      }
      app.log.info({ completed: outcomes.filter((item) => item.ok).length, markets: outcomes.length }, 'Scheduled paper scan completed');
    } finally { scanInProgress = false; }
  }, paperConfig.autoIntervalMinutes * 60_000);
  timer.unref();
  app.log.info({ timeframe: paperConfig.autoTimeframe, intervalMinutes: paperConfig.autoIntervalMinutes, markets: paperConfig.symbols.length }, 'Scheduled paper analysis enabled');
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await app.close(); await pool.end(); process.exit(0); });
