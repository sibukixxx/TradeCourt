// Kept out of src/index.ts: a Worker entry module may only export handlers.
/**
 * Latest migration this code needs. Keep in sync with apps/api/migrations (a test enforces it).
 * /api/health reports setup_required until Wrangler has recorded it in d1_migrations, so pulling
 * new code without `make migrate` gives a clear message instead of "no such column" 500s.
 */
export const REQUIRED_MIGRATION = '0004_market_link_timezone.sql'
