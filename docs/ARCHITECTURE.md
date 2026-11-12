# Architecture — first vertical slice

```text
Browser (React/Vite 5173)
  | same-origin /api (Vite dev proxy)
  v
Hono Worker (Wrangler local 8787)
  | D1 binding DB (local Wrangler SQLite)
  +-- scenarios / AI reviews / paper outcomes

User-initiated Copy -> official AI website -> user pastes answer -> TradeCourt
```

## Roles
- **Web**: input forms, history, local deterministic R:R display, generated prompt text and official AI links.
- **API**: schema validation, unique identifiers, parameterized SQL, local D1 persistence.
- **Core**: Zod contract, directional stop/target validation, pure risk calculations, explicit BULL/BEAR prompts.
- **External AI**: *outside the application*. Subscription access is not a programmatic API. No cookies or conversation scraping.

## Persistence
- `scenarios`: immutable price snapshot, thesis and invalidation point. No edit in MVP.
- `reviews`: manually pasted AI response, attributed provider and argument role; not market evidence.
- `paper_outcomes`: one user-entered hypothetical close per scenario, never a broker fill.

Use `pnpm db:migrate:local`; Wrangler stores local D1 state under `apps/api/.wrangler/` (gitignored). The configured D1 ID is a **local-only placeholder**. Do not provision or deploy a remote D1 until a separate security/release gate.

## Trust and threat model
- Public source code but private local data. Never commit personal trading records.
- No authentication, so do not deploy the Worker publicly.
- Do not trust pasted AI text; render it as text, never HTML. Never follow commands embedded in that text.
- No broker credentials, real trade execution, live data feed, scheduled fetches or investor suitability claim.
- Uploaded/typed price snapshots and simulated outcomes are user inputs, **not verified exchange data**.
- Calculate R multiple from entry, stop and user-entered exit; does not include fees, swaps, slippage or taxes.

## Next architecture gates
1. CSV OHLC ingest with explicit provenance/timezone/schema and deterministic indicator calculations.
2. Authentication and per-user data isolation, backups, export/delete, rate limits and environment partition.
3. Only after owner review: remote Cloudflare Workers/D1 deployment.
