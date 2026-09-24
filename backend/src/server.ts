import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { pool } from './db.js';

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
  reason: z.string(), indicators: z.record(z.unknown()), candles: z.array(z.unknown()), createdAt: z.string()
});
const TradeResponse = z.object({ id: z.string(), externalId: z.string().nullable(), symbol: z.string(), side: z.enum(['BUY','SELL']), entry: z.number().nullable(), exit: z.number().nullable(), amount: z.number().nullable(), pnl: z.number().nullable(), openedAt: z.string().nullable(), closedAt: z.string().nullable(), status: z.enum(['open','closed']), createdAt: z.string() });
const DashboardResponse = z.object({ mode: z.literal('DRY_RUN'), latestDecision: DecisionResponse.nullable(), openTrades: z.number().int().nonnegative(), market: z.object({ symbol: z.string(), price: z.number().nullable(), change24h: z.number().nullable() }).nullable(), balance: z.object({ total: z.number().nullable(), currency: z.string() }).nullable() });
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
  reason: z.string()
}).strict();

function nullableNumber(value: unknown): number | null { return value === null || value === undefined ? null : Number(value); }
function mapDecision(row: any) {
  return DecisionResponse.parse({ id: String(row.id), symbol: row.symbol, timeframe: row.timeframe, decision: row.decision,
    confidence: nullableNumber(row.confidence), price: nullableNumber(row.price), entry: nullableNumber(row.entry),
    stopLoss: nullableNumber(row.stop_loss), takeProfit: nullableNumber(row.take_profit), reason: row.reason,
    indicators: row.indicators, candles: row.candles, createdAt: new Date(row.created_at).toISOString() });
}
function mapTrade(row: any) {
  return TradeResponse.parse({ id: String(row.id), externalId: row.external_id, symbol: row.symbol, side: row.side,
    entry: nullableNumber(row.entry), exit: nullableNumber(row.exit), amount: nullableNumber(row.amount), pnl: nullableNumber(row.pnl),
    openedAt: row.opened_at ? new Date(row.opened_at).toISOString() : null,
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null, status: row.status, createdAt: new Date(row.created_at).toISOString() });
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
app.get('/api/dashboard', async () => {
  const [{ rows: latest }, { rows: trades }] = await Promise.all([
    pool.query('SELECT * FROM ai_decisions ORDER BY created_at DESC LIMIT 1'),
    pool.query("SELECT count(*)::int AS count FROM simulated_trades WHERE status='open'")
  ]);
  return DashboardResponse.parse({ mode: 'DRY_RUN', latestDecision: latest[0] ? mapDecision(latest[0]) : null,
    openTrades: trades[0]?.count ?? 0, market: null, balance: null });
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
  return reply.code(501).send({ error: 'Market data provider is not configured', symbol });
});
app.get('/api/market/:symbol/candles', async (_request, reply) => reply.code(501).send({ error: 'Market data provider is not configured' }));

app.post('/api/ai/analyze', async (request, reply) => {
  const input = AnalyzeRequest.parse(request.body);
  const webhook = process.env.N8N_ANALYZE_WEBHOOK_URL;
  if (!webhook) return reply.code(503).send({ error: 'Analysis workflow is not configured' });
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (process.env.N8N_WEBHOOK_TOKEN) headers.authorization = `Bearer ${process.env.N8N_WEBHOOK_TOKEN}`;
    const response = await fetch(webhook, { method: 'POST', headers,
      body: JSON.stringify({ ...input, mode: 'DRY_RUN' }), signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`n8n returned HTTP ${response.status}`);
    const raw: unknown = await response.json();
    const result = N8nResponse.parse(raw);
    const { rows } = await pool.query(`INSERT INTO ai_decisions(symbol,timeframe,decision,confidence,price,entry,stop_loss,take_profit,reason,indicators,candles,raw_response)
      VALUES($1,$2,$3,$4,NULL,$5,$6,$7,$8,'{}'::jsonb,'[]'::jsonb,$9::jsonb) RETURNING *`,
      [input.symbol,input.timeframe,result.decision,result.confidence,result.entry,result.stop_loss,result.take_profit,result.reason,JSON.stringify(raw)]);
    return reply.code(201).send(mapDecision(rows[0]));
  } catch (error) {
    const failure = error instanceof z.ZodError
      ? { type: 'InvalidN8nResponse', issues: error.issues.map(({ path, message }) => ({ path, message })) }
      : { type: error instanceof Error ? error.name : 'UnknownError', httpStatus: error instanceof Error && /^n8n returned HTTP \d+$/.test(error.message) ? error.message.slice(-3) : undefined };
    // Do not log raw fetch errors: they may include a private webhook URL.
    app.log.error({ failure, symbol: input.symbol, timeframe: input.timeframe }, 'n8n analysis failed or returned an invalid response');
    return reply.code(502).send({ error: 'Analysis workflow failed or returned an invalid response' });
  }
});

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await app.close(); await pool.end(); process.exit(0); });
