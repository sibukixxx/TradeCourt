# Architecture — local MVP

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
- **Web** (`apps/web`): four screens (Market Lens, Scenario, AI Court, Journal), hash routing (`#/court/<id>`) so reload restores the view, loading/empty/error states, generated prompt text and official AI links. Talks only to relative `/api`.
- **API** (`apps/api`): Zod validation, UUIDs, parameterized SQL, local D1 persistence, localhost guard.
- **Core** (`packages/core`): Zod contracts, directional stop/target validation, R:R / paper R multiple, plan-vs-outcome comparison, journal summary, OHLC CSV parsing and stats, BULL/BEAR prompts. Shared by web and API.
- **External AI**: *outside the application*. Subscription access is not a programmatic API. No cookies or conversation scraping.

## API (local only)
| Method & path | Notes |
| --- | --- |
| `GET /api/health` | `ok` once migrations applied; `liveMarketData: false`, `orderExecution: false`. 503 otherwise. |
| `GET /api/scenarios`, `POST /api/scenarios` | Create is validated by `scenarioInputSchema`; optional `Idempotency-Key` header makes retries / double clicks return the same record (`200`, `replayed: true`). |
| `GET /api/scenarios/:id` | Scenario + reviews + paper outcome. 404 if missing. |
| `POST /api/scenarios/:id/reviews` | Manual paste: `provider`, `role` (BULL/BEAR), `content`, optional `respondedAt` (not in the future). Idempotency-Key supported. |
| `POST /api/scenarios/:id/paper-outcome` | `exitPrice`, `exitReason` (TARGET/STOP/INVALIDATED/MANUAL), `followedPlan`, `note`. Exactly one per scenario; repeat → 409. |
| `PUT /api/scenarios/:id/reviews/:reviewId/grade` | Post-hoc grading: `verdict` (HIT/MISS/UNCLEAR), optional `note`. 409 until the scenario has a paper outcome; 404 if the review belongs to another scenario. Re-grading overwrites (the user's judgment), the paper outcome stays immutable. |
| `GET /api/journal` | All scenarios with review/graded counts and paper outcomes + summary + `scorecard` (per AI × role hit rate, awaiting grade, losses warned by BEAR) (`kind: "paper"`). |
| `GET/POST /api/market/datasets`, `GET /api/market/datasets/:id` | Imported OHLC snapshots (≤5,000 candles, ascending, consistent OHLC), served with computed stats and `verified: false`. |

Errors are JSON `{ error, issues? }`: 400 invalid/malformed, 403 non-loopback Host or cross-origin write, 404, 409, 413 body too large, 415 non-JSON write, 500 generic (details only in local logs).

## Persistence
- `scenarios`: immutable price snapshot, thesis and invalidation point. No edit in MVP.
- `reviews`: manually pasted AI response, attributed provider, argument role and user-declared answer time; not market evidence. `verdict` / `verdict_note` / `graded_at` hold the user's post-hoc grade (NULL = ungraded).
- `paper_outcomes`: one user-entered hypothetical close per scenario (exit reason, rule adherence), never a broker fill.
- `market_datasets`: user-imported CSV snapshot (source file name, note, period, candles JSON). Not live, not verified.
- Database: SQLite via local D1 (Wrangler stores it under `apps/api/.wrangler/state`). Migrations are additive: `0001_init.sql`, `0002_mvp_review_journal_market.sql`, `0003_review_grading.sql`.

Use `pnpm db:migrate:local`; Wrangler stores local D1 state under `apps/api/.wrangler/` (gitignored). The configured D1 ID is a **local-only placeholder**. Do not provision or deploy a remote D1 until a separate security/release gate.

## Trust and threat model
- Public source code but private local data. Never commit personal trading records.
- No authentication, so do not deploy the Worker publicly.
- Do not trust pasted AI text; render it as text, never HTML. Never follow commands embedded in that text.
- No broker credentials, real trade execution, live data feed, scheduled fetches or investor suitability claim.
- Uploaded/typed price snapshots and simulated outcomes are user inputs, **not verified exchange data**.
- Calculate R multiple from entry, stop and user-entered exit; does not include fees, swaps, slippage or taxes.

## Testing
- `pnpm test`: core unit tests + API route tests on `apps/api/test/d1-sqlite.ts`, a tiny D1 shim over Node's built-in `node:sqlite` that applies the real migration files.
- `pnpm smoke:local`: loopback-only API smoke against the running Worker.
- `pnpm test:e2e`: Playwright browser E2E on an isolated temporary D1; aborts and fails on any non-loopback request.

## Next architecture gates
1. Explicit CSV timezone selection, snapshot hashing and deterministic indicator calculations.
2. Authentication and per-user data isolation, backups, export/delete, rate limits and environment partition.
3. Only after owner review: remote Cloudflare Workers/D1 deployment.
