CREATE TABLE IF NOT EXISTS market_candles (
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  candle_at TIMESTAMPTZ NOT NULL,
  open NUMERIC(24,8),
  high NUMERIC(24,8),
  low NUMERIC(24,8),
  close NUMERIC(24,8) NOT NULL,
  volume NUMERIC(30,10),
  indicators JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(symbol, timeframe, candle_at)
);
CREATE INDEX IF NOT EXISTS market_candles_lookup_idx
  ON market_candles(symbol, timeframe, candle_at DESC);

CREATE TABLE IF NOT EXISTS analysis_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT false,
  symbols TEXT[] NOT NULL,
  timeframe TEXT NOT NULL DEFAULT '5m',
  interval_minutes INTEGER NOT NULL DEFAULT 240 CHECK (interval_minutes BETWEEN 30 AND 10080),
  history_days INTEGER NOT NULL DEFAULT 90 CHECK (history_days BETWEEN 7 AND 180),
  last_enqueued_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analysis_jobs (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  history_days INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','schedule')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  decision_id BIGINT REFERENCES ai_decisions(id),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS analysis_jobs_queue_idx ON analysis_jobs(status, run_after, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS analysis_jobs_one_active_market_idx
  ON analysis_jobs(symbol,timeframe) WHERE status IN ('pending','processing');

ALTER TABLE ai_decisions
  ADD COLUMN IF NOT EXISTS job_id BIGINT UNIQUE REFERENCES analysis_jobs(id);
