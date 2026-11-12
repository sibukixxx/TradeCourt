-- TradeCourt P0 local D1 data. No user accounts and no broker execution.
CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL CHECK (symbol = 'USDJPY'),
  timeframe TEXT NOT NULL CHECK (timeframe IN ('1h','4h','1d')),
  side TEXT NOT NULL CHECK (side IN ('LONG','SHORT')),
  entry REAL NOT NULL CHECK (entry > 0),
  stop REAL NOT NULL CHECK (stop > 0),
  target REAL NOT NULL CHECK (target > 0),
  thesis TEXT NOT NULL,
  invalidation TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scenarios_created_at ON scenarios(created_at DESC);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('chatgpt','claude','gemini','grok','other')),
  role TEXT NOT NULL CHECK (role IN ('BULL','BEAR')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reviews_scenario ON reviews(scenario_id,created_at);

-- Hypothetical, manually entered outcome; not market-feed-verified.
CREATE TABLE IF NOT EXISTS paper_outcomes (
  scenario_id TEXT PRIMARY KEY REFERENCES scenarios(id) ON DELETE CASCADE,
  exit_price REAL NOT NULL CHECK (exit_price > 0),
  r_multiple REAL NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  recorded_at TEXT NOT NULL
);
