# Roadmap

## P0 — local-first functional skeleton
- [x] Repository instructions and pnpm workspace.
- [x] Hono Worker routes for health, scenarios, reviews and manual paper outcomes.
- [x] React/Vite workspace and human-in-the-loop AI workflow.
- [x] SQLite-backed local D1 migration.
- [x] Actually execute install, migrations, tests, typecheck, build, API smoke and browser E2E (cloud Linux container, 2026-11-12; see README). Owner workstation run still pending.
- [x] Generate and commit `pnpm-lock.yaml`; `pnpm install --frozen-lockfile` verified.
- [x] Four screens: Market Lens (CSV), Scenario, AI Court (BULL/BEAR, 4 providers, comparison), Journal (paper R multiple, plan vs outcome, history).
- [x] Idempotent create (double submit), immutable paper outcome (409), localhost guard, body limits.
- [x] Playwright browser E2E (`pnpm test:e2e`) on isolated temp D1.

## P1 — market evidence
- [x] OHLC CSV import, source/schema validation and upload bounds (timezone is recorded as "as written in CSV", not yet selectable).
- [ ] Deterministic multi-timeframe trend / support/resistance, with parameterized rebounce definitions.
- [ ] Immutable scenario and candle snapshot hashing; no look-ahead bias.
- [x] Plan vs user-entered paper outcome comparison and basic journal summary (wins/losses, total/avg R, rule adherence).
- [ ] Review quality metrics (which AI argument proved right) and limitations.

## P2 — use outside localhost
- [ ] Security review (auth, access, per-user isolation, CORS/CSRF and data retention).
- [ ] D1 migration/backup/restore and environment separation.
- [ ] Cloudflare deployment with explicit owner approval and cost caps.
- [ ] Broker CSV read-only import, if later useful. Still **no order execution**.

**Non-goals:** buy/sell recommendations, guaranteed returns, automatic broker trades, AI subscription browser automation or paid LLM API calls.
