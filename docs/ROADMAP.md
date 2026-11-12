# Roadmap

## P0 — local-first functional skeleton
- [x] Repository instructions and pnpm workspace.
- [x] Hono Worker routes for health, scenarios, reviews and manual paper outcomes.
- [x] Preact/Vite workspace (migrated from React: ~58% smaller JS bundle) and human-in-the-loop AI workflow.
- [x] SQLite-backed local D1 migration.
- [x] Actually execute install, migrations, tests, typecheck, build, API smoke and browser E2E (cloud Linux container, 2026-11-12; see README). Owner workstation run still pending.
- [x] Generate and commit `pnpm-lock.yaml`; `pnpm install --frozen-lockfile` verified.
- [x] Four screens: Market Lens (CSV), Scenario, AI Court (BULL/BEAR, 4 providers, comparison), Journal (paper R multiple, plan vs outcome, history).
- [x] Idempotent create (double submit), immutable paper outcome (409), localhost guard, body limits.
- [x] Playwright browser E2E (`pnpm test:e2e`) on isolated temp D1.

## P1 — market evidence
- [x] OHLC CSV import, source/schema validation and upload bounds; explicit fixed-offset timezone per import.
- [x] Link scenarios to an as-of candle; deterministic, look-ahead-free stop/target first-touch check against later imported candles (reference only).
- [ ] Deterministic multi-timeframe trend / support/resistance, with parameterized rebounce definitions.
- [ ] Candle snapshot hashing (look-ahead is already prevented by the as-of close rule).
- [ ] DST-aware timezones (IANA zones) for CSV imports.
- [x] Plan vs user-entered paper outcome comparison and basic journal summary (wins/losses, total/avg R, rule adherence).
- [x] Review quality metrics: post-hoc grading of each AI review (的中/外れ/判定不能) and per AI × BULL/BEAR hit-rate scorecard.
- [x] Phone UI: bottom tab bar, scenario picker, card tables, touch targets.
- [x] Data export (JSON/CSV) and SQL backup/restore (`make db-backup` / `db-restore`).
- [x] Decision-habit analysis (Insights): rule adherence, exit reasons, plan vs CSV path gaps, cumulative paper R.
- [x] Rule-based level drafts from imported candles (swing / ATR stop, R target) and one-tap paper outcomes.
- [x] Entry default from the latest imported CSV close; optional user-pressed ECB daily reference quote (QUOTE_PROVIDER, can be off).
- [ ] Strategy tags on scenarios for per-setup analysis.

## P2 — use outside localhost
- [ ] Security review (auth, access, per-user isolation, CORS/CSRF and data retention).
- [ ] D1 migration/backup/restore and environment separation.
- [ ] Cloudflare deployment with explicit owner approval and cost caps.
- [ ] Broker CSV read-only import, if later useful. Still **no order execution**.

**Non-goals:** buy/sell recommendations, guaranteed returns, automatic broker trades, AI subscription browser automation or paid LLM API calls.
