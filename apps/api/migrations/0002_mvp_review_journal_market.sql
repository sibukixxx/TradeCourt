-- TradeCourt P0 MVP: additive changes only. Local D1. No accounts, no broker data.

-- Client idempotency keys prevent double submission (double click / retry) from creating duplicates.
ALTER TABLE scenarios ADD COLUMN client_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scenarios_client_request
  ON scenarios(client_request_id) WHERE client_request_id IS NOT NULL;

-- User-declared time the external AI answered (manual paste). NULL for legacy rows -> created_at.
ALTER TABLE reviews ADD COLUMN responded_at TEXT;
ALTER TABLE reviews ADD COLUMN client_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_client_request
  ON reviews(client_request_id) WHERE client_request_id IS NOT NULL;

-- Paper (hypothetical) outcome context. Still user-entered, never a broker fill.
ALTER TABLE paper_outcomes ADD COLUMN exit_reason TEXT NOT NULL DEFAULT 'MANUAL'
  CHECK (exit_reason IN ('TARGET','STOP','INVALIDATED','MANUAL'));
ALTER TABLE paper_outcomes ADD COLUMN followed_plan INTEGER NOT NULL DEFAULT 1
  CHECK (followed_plan IN (0,1));

-- User-imported OHLC CSV snapshots. Not live, not verified exchange data.
CREATE TABLE IF NOT EXISTS market_datasets (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL CHECK (symbol = 'USDJPY'),
  timeframe TEXT NOT NULL CHECK (timeframe IN ('1h','4h','1d')),
  source_name TEXT NOT NULL,
  source_note TEXT NOT NULL DEFAULT '',
  candle_count INTEGER NOT NULL CHECK (candle_count BETWEEN 2 AND 5000),
  first_date TEXT NOT NULL,
  last_date TEXT NOT NULL,
  candles_json TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  client_request_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_market_datasets_imported ON market_datasets(imported_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_datasets_client_request
  ON market_datasets(client_request_id) WHERE client_request_id IS NOT NULL;
