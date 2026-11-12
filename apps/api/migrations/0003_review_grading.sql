-- Post-hoc grading ("答え合わせ") of manually pasted AI reviews. Additive, SQLite / local D1.
-- A verdict is the user's subjective judgment against their own PAPER outcome, not market verification.
ALTER TABLE reviews ADD COLUMN verdict TEXT CHECK (verdict IS NULL OR verdict IN ('HIT','MISS','UNCLEAR'));
ALTER TABLE reviews ADD COLUMN verdict_note TEXT NOT NULL DEFAULT '';
ALTER TABLE reviews ADD COLUMN graded_at TEXT;

CREATE INDEX IF NOT EXISTS idx_reviews_provider_role ON reviews(provider, role);
