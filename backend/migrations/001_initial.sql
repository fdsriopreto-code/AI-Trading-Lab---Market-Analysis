CREATE TABLE IF NOT EXISTS ai_decisions (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('BUY','SELL','HOLD')),
  confidence NUMERIC(6,5) CHECK (confidence BETWEEN 0 AND 1),
  price NUMERIC(24,8),
  entry NUMERIC(24,8),
  stop_loss NUMERIC(24,8),
  take_profit NUMERIC(24,8),
  reason TEXT NOT NULL DEFAULT '',
  indicators JSONB NOT NULL DEFAULT '{}'::jsonb,
  candles JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_decisions_symbol_created_idx ON ai_decisions(symbol, created_at DESC);
CREATE TABLE IF NOT EXISTS simulated_trades (
  id BIGSERIAL PRIMARY KEY,
  external_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  entry NUMERIC(24,8), exit NUMERIC(24,8), amount NUMERIC(24,8), pnl NUMERIC(24,8),
  opened_at TIMESTAMPTZ, closed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'closed' CHECK (status IN ('open','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
