CREATE TABLE IF NOT EXISTS paper_portfolio (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  currency TEXT NOT NULL DEFAULT 'USDT',
  initial_balance NUMERIC(24,8) NOT NULL CHECK (initial_balance > 0),
  cash_balance NUMERIC(24,8) NOT NULL CHECK (cash_balance >= 0),
  realized_pnl NUMERIC(24,8) NOT NULL DEFAULT 0,
  peak_equity NUMERIC(24,8) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE simulated_trades
  ADD COLUMN IF NOT EXISTS decision_id BIGINT REFERENCES ai_decisions(id),
  ADD COLUMN IF NOT EXISTS entry_fee NUMERIC(24,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exit_fee NUMERIC(24,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stop_loss NUMERIC(24,8),
  ADD COLUMN IF NOT EXISTS take_profit NUMERIC(24,8),
  ADD COLUMN IF NOT EXISTS last_price NUMERIC(24,8),
  ADD COLUMN IF NOT EXISTS close_reason TEXT;

ALTER TABLE ai_decisions
  ADD COLUMN IF NOT EXISTS paper_action TEXT,
  ADD COLUMN IF NOT EXISTS paper_message TEXT;

CREATE INDEX IF NOT EXISTS simulated_trades_symbol_status_idx
  ON simulated_trades(symbol, status, created_at DESC);
CREATE INDEX IF NOT EXISTS simulated_trades_decision_idx
  ON simulated_trades(decision_id) WHERE decision_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS decision_outcomes (
  id BIGSERIAL PRIMARY KEY,
  decision_id BIGINT NOT NULL UNIQUE REFERENCES ai_decisions(id) ON DELETE CASCADE,
  horizon_candles INTEGER NOT NULL CHECK (horizon_candles > 0),
  reference_price NUMERIC(24,8) NOT NULL,
  evaluated_price NUMERIC(24,8) NOT NULL,
  return_pct NUMERIC(12,8) NOT NULL,
  label TEXT NOT NULL CHECK (label IN ('FAVORABLE','UNFAVORABLE','FLAT')),
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS decision_outcomes_evaluated_idx
  ON decision_outcomes(evaluated_at DESC);
