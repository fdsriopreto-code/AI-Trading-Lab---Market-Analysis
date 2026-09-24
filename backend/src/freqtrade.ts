import { pool } from './db.js';

export type Candle = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  indicators: Record<string, number | null>;
};

const baseUrl = (process.env.FREQTRADE_API_URL ?? '').trim().replace(/\/$/, '');
const strategy = (process.env.FREQTRADE_STRATEGY ?? '').trim();
const username = process.env.FREQTRADE_API_USERNAME ?? '';
const password = process.env.FREQTRADE_API_PASSWORD ?? '';
const indicatorKeys = ['rsi','adx','mfi','macd','macdsignal','macdhist','bb_lowerband','bb_middleband','bb_upperband','bb_percent','bb_width','sar','tema','fastd','fastk'];

function apiUrl(path: string) {
  if (!baseUrl) throw new Error('FREQTRADE_API_URL is not configured.');
  const root = baseUrl.endsWith('/api/v1') ? baseUrl : `${baseUrl}/api/v1`;
  return `${root}/${path.replace(/^\//, '')}`;
}
function authHeaders() {
  if (!username || !password) throw new Error('Freqtrade API credentials are not configured.');
  return { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` };
}
function dateKey(date: Date) { return date.toISOString().slice(0, 10).replaceAll('-', ''); }
function timestamp(value: unknown): number {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  const time = Date.parse(String(value ?? ''));
  return Number.isFinite(time) ? time : NaN;
}
function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function responseRows(payload: any): any[] {
  if (Array.isArray(payload?.data) && Array.isArray(payload?.columns)) {
    return payload.data.map((values: unknown[]) => Object.fromEntries(payload.columns.map((key: string, i: number) => [key, values[i] ?? null])));
  }
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.candles)) return payload.candles;
  return Array.isArray(payload) ? payload : [];
}

export async function freqtradeHealth() {
  try {
    const response = await fetch(apiUrl('ping'), { headers: authHeaders(), signal: AbortSignal.timeout(5_000) });
    return response.ok ? { status: 'online' as const } : { status: 'error' as const, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { status: baseUrl ? 'offline' as const : 'not_configured' as const, detail: error instanceof Error ? error.message : 'Freqtrade unavailable' };
  }
}

export async function freqtradeMarkets(timeframe = '5m'): Promise<string[]> {
  const headers=authHeaders();
  const availableUrl=new URL(apiUrl('available_pairs'));
  availableUrl.search=new URLSearchParams({timeframe,stake_currency:'USDT'}).toString();
  const [whitelistResult,availableResult]=await Promise.allSettled([
    fetch(apiUrl('whitelist'),{headers,signal:AbortSignal.timeout(8_000)}),
    fetch(availableUrl,{headers,signal:AbortSignal.timeout(8_000)})
  ]);
  const extract=async(result:PromiseSettledResult<Response>,label:string):Promise<any[]>=>{
    if(result.status==='rejected')return [];
    if(!result.value.ok){if(label==='whitelist')throw new Error(`Freqtrade whitelist returned HTTP ${result.value.status}`);return [];}
    const data:any=await result.value.json();
    return Array.isArray(data)?data:data?.whitelist??data?.pairs??[];
  };
  const lists=await Promise.all([extract(whitelistResult,'whitelist'),extract(availableResult,'available_pairs')]);
  const symbols=lists.flat().map((item:any)=>typeof item==='string'?item:item?.pair).filter((item:unknown):item is string=>typeof item==='string'&&/^[A-Z0-9]+\/[A-Z0-9]+$/.test(item));
  return [...new Set<string>(symbols)].slice(0,100);
}

export async function collectMarketHistory(symbol: string, timeframe: string, historyDays: number) {
  if (!strategy) throw new Error('FREQTRADE_STRATEGY is required for the pair_history endpoint.');
  const { rows: latestRows } = await pool.query('SELECT MAX(candle_at) AS latest FROM market_candles WHERE symbol=$1 AND timeframe=$2', [symbol, timeframe]);
  const requestedStart = Date.now() - historyDays * 86_400_000;
  // Re-fetch a two-day overlap so the newest strategy indicators can be refreshed without downloading the full lookback every cycle.
  const startMs = Math.max(requestedStart, latestRows[0].latest ? new Date(latestRows[0].latest).getTime() - 2 * 86_400_000 : requestedStart);
  const start = new Date(startMs);
  const end = new Date();
  const params = new URLSearchParams({ pair: symbol, timeframe, strategy, timerange: `${dateKey(start)}-${dateKey(end)}` });
  const response = await fetch(`${apiUrl('pair_history')}?${params}`, { headers: authHeaders(), signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`Freqtrade pair_history returned HTTP ${response.status}`);
  const raw = await response.json();
  const candles: Candle[] = responseRows(raw).flatMap((row: any) => {
    const ts = timestamp(row?.date);
    const close = finite(row?.close);
    if (!Number.isFinite(ts) || close === null || close <= 0) return [];
    const indicators: Record<string, number | null> = {};
    for (const key of indicatorKeys) if (Object.hasOwn(row, key)) indicators[key] = finite(row[key]);
    return [{ date: new Date(ts).toISOString(), open: finite(row.open), high: finite(row.high), low: finite(row.low), close, volume: finite(row.volume), indicators }];
  }).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  if (!candles.length) throw new Error(`Freqtrade returned no candles for ${symbol} ${timeframe}. Check downloaded market history and strategy.`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let offset = 0; offset < candles.length; offset += 150) {
      const batch = candles.slice(offset, offset + 150);
      const values: unknown[] = [];
      const tuples = batch.map((candle, index) => {
        const base = index * 9;
        values.push(symbol, timeframe, candle.date, candle.open, candle.high, candle.low, candle.close, candle.volume, JSON.stringify(candle.indicators));
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9}::jsonb,now())`;
      });
      await client.query(`INSERT INTO market_candles(symbol,timeframe,candle_at,open,high,low,close,volume,indicators,fetched_at) VALUES ${tuples.join(',')}
        ON CONFLICT(symbol,timeframe,candle_at) DO UPDATE SET open=EXCLUDED.open,high=EXCLUDED.high,low=EXCLUDED.low,close=EXCLUDED.close,volume=EXCLUDED.volume,indicators=EXCLUDED.indicators,fetched_at=now()`, values);
    }
    await client.query('DELETE FROM market_candles WHERE symbol=$1 AND timeframe=$2 AND candle_at < now() - make_interval(days => $3::int + 7)', [symbol, timeframe, historyDays]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS count,MIN(candle_at) AS oldest,MAX(candle_at) AS newest FROM market_candles WHERE symbol=$1 AND timeframe=$2 AND candle_at >= now() - make_interval(days => $3::int)', [symbol, timeframe, historyDays]);
  return { fetched: candles.length, stored: Number(countRows[0].count), oldest: countRows[0].oldest, newest: countRows[0].newest };
}

export function createMarketContext(symbol: string, timeframe: string, rows: any[], historyDays: number) {
  const candles: Candle[] = rows.map((row) => ({
    date: new Date(row.candle_at).toISOString(), open: finite(row.open), high: finite(row.high), low: finite(row.low), close: finite(row.close)!, volume: finite(row.volume), indicators: row.indicators ?? {}
  }));
  const daily = new Map<string, any>();
  for (const candle of candles) {
    const date = candle.date.slice(0, 10);
    let day = daily.get(date);
    if (!day) { day = { date, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: 0, ...candle.indicators }; daily.set(date, day); }
    if (candle.high !== null) day.high = Math.max(day.high ?? candle.high, candle.high);
    if (candle.low !== null) day.low = Math.min(day.low ?? candle.low, candle.low);
    day.close = candle.close;
    day.volume += candle.volume ?? 0;
    Object.assign(day, candle.indicators);
  }
  const dailySeries = [...daily.values()];
  const closes = dailySeries.map((day) => day.close as number);
  const changes = closes.slice(1).flatMap((close, i) => closes[i] > 0 ? [(close / closes[i] - 1) * 100] : []);
  const ranges = dailySeries.flatMap((day) => day.low > 0 ? [(day.high - day.low) / day.low * 100] : []);
  let peak = closes[0] ?? 0;
  let maxDrawdownPct = 0;
  for (const close of closes) { peak = Math.max(peak, close); if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, (peak - close) / peak * 100); }
  const recent = candles.slice(-30);
  const currentCandle = recent.at(-1)!;
  const indicators = currentCandle.indicators;
  const context = {
    symbol, timeframe, mode: 'DRY_RUN',
    current: {
      price: currentCandle.close, date: currentCandle.date, volume: currentCandle.volume,
      rsi: indicators.rsi ?? null, adx: indicators.adx ?? null, mfi: indicators.mfi ?? null,
      macd: indicators.macd ?? null, macd_signal: indicators.macdsignal ?? null, macd_hist: indicators.macdhist ?? null,
      bb_lower: indicators.bb_lowerband ?? null, bb_middle: indicators.bb_middleband ?? null, bb_upper: indicators.bb_upperband ?? null,
      bb_percent: indicators.bb_percent ?? null, bb_width: indicators.bb_width ?? null, sar: indicators.sar ?? null,
      tema: indicators.tema ?? null, fastd: indicators.fastd ?? null, fastk: indicators.fastk ?? null,
      open: currentCandle.open, high: currentCandle.high, low: currentCandle.low
    },
    historicalSummary: {
      source: 'Freqtrade + PostgreSQL', historyDays, candleCount: candles.length, dailyPointCount: dailySeries.length,
      start: candles[0].date, end: currentCandle.date,
      netChangePct: candles[0].open && candles[0].open > 0 ? Number(((currentCandle.close / candles[0].open - 1) * 100).toFixed(2)) : null,
      upDays: changes.filter((value) => value > 0).length, downDays: changes.filter((value) => value < 0).length,
      averageDailyRangePct: ranges.length ? Number((ranges.reduce((a, b) => a + b, 0) / ranges.length).toFixed(2)) : null,
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)), dailySeries
    },
    candles: recent.map((candle) => ({ date: candle.date, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, ...candle.indicators }))
  };
  return context;
}

export async function readMarketContext(symbol: string, timeframe: string, historyDays: number) {
  const { rows } = await pool.query(`SELECT candle_at,open,high,low,close,volume,indicators FROM market_candles
    WHERE symbol=$1 AND timeframe=$2 AND candle_at >= now() - make_interval(days => $3::int)
    ORDER BY candle_at`, [symbol, timeframe, historyDays]);
  if (!rows.length) throw new Error(`No saved market history for ${symbol} ${timeframe}.`);
  return createMarketContext(symbol, timeframe, rows, historyDays);
}
