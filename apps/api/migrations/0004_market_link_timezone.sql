-- Link scenarios to an imported CSV candle and record CSV timezone. Additive, SQLite / local D1.
-- Imported candles remain user-supplied, unverified data; the link is part of the immutable scenario.

-- Fixed UTC offset (e.g. '+09:00') for timestamps written without one. NULL = not specified.
ALTER TABLE market_datasets ADD COLUMN tz_offset TEXT;

-- Optional market link, set only at scenario creation.
ALTER TABLE scenarios ADD COLUMN dataset_id TEXT REFERENCES market_datasets(id);
ALTER TABLE scenarios ADD COLUMN as_of_candle TEXT;
-- ISO UTC instant of the as-of candle close; path checks use candles opening at/after this.
ALTER TABLE scenarios ADD COLUMN as_of_at TEXT;
