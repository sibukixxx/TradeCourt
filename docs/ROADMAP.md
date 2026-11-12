# Roadmap

## P0 — local-first functional skeleton
- [x] Repository instructions and pnpm workspace.
- [x] Hono Worker routes for health, scenarios, reviews and manual paper outcomes.
- [x] React/Vite workspace and human-in-the-loop AI workflow.
- [x] SQLite-backed local D1 migration.
- [ ] **Actually execute** install, migrations, tests, typecheck, build, browser/API E2E on a development workstation. Source-code creation alone is not verification.
- [ ] Generate and commit a dependency lockfile from a trusted installation and verify fresh clone reproducibility.

## P1 — market evidence
- [ ] OHLC CSV import, source/timezone/schema validation and upload bounds.
- [ ] Deterministic multi-timeframe trend / support/resistance, with parameterized rebounce definitions.
- [ ] Immutable scenario and candle snapshot hashing; no look-ahead bias.
- [ ] Review vs realized user-entered/verified-price outcomes; quality metrics and limitations.

## P2 — use outside localhost
- [ ] Security review (auth, access, per-user isolation, CORS/CSRF and data retention).
- [ ] D1 migration/backup/restore and environment separation.
- [ ] Cloudflare deployment with explicit owner approval and cost caps.
- [ ] Broker CSV read-only import, if later useful. Still **no order execution**.

**Non-goals:** buy/sell recommendations, guaranteed returns, automatic broker trades, AI subscription browser automation or paid LLM API calls.
