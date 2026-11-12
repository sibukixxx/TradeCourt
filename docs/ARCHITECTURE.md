# Architecture — local MVP

```text
Browser (Preact/Vite 5173)
  | same-origin /api (Vite dev proxy)
  v
Hono Worker (Wrangler local 8787)
  | D1 binding DB (local Wrangler SQLite)
  +-- scenarios / AI reviews / paper outcomes

User-initiated Copy -> official AI website -> user pastes answer -> TradeCourt
```

## Roles
- **Web** (`apps/web`, Preact 10 + Vite 8; JSX via `jsxImportSource: "preact"`, no UI/router/state libraries): four screens (Market Lens, Scenario, AI Court, Journal), hash routing (`#/court/<id>`) so reload restores the view, loading/empty/error states, generated prompt text and official AI links. Talks only to relative `/api`.
- **API** (`apps/api`): Zod validation, UUIDs, parameterized SQL, local D1 persistence, localhost guard.
- **Core** (`packages/core`): Zod contracts, directional stop/target validation, R:R / paper R multiple, plan-vs-outcome comparison, journal summary, OHLC CSV parsing and stats, BULL/BEAR prompts. Shared by web and API.
- **External AI**: *outside the application*. Subscription access is not a programmatic API. No cookies or conversation scraping.

## API (local only)
| Method & path | Notes |
| --- | --- |
| `GET /api/health` | `ok` once migrations applied; `liveMarketData: false`, `orderExecution: false`, `quoteProvider`. 503 otherwise. |
| `GET /api/quote/usdjpy` | Optional, user-initiated reference quote (`QUOTE_PROVIDER`: `frankfurter` = ECB daily reference rate via api.frankfurter.dev; `off` → 403; `synthetic` = fixed test value). Provider failures → 502. Called only when the user presses 現在値を取得; never on load or in the background. |
| `GET /api/scenarios`, `POST /api/scenarios` | Create is validated by `scenarioInputSchema`; optional `Idempotency-Key` header makes retries / double clicks return the same record (`200`, `replayed: true`). Optional `marketRef: { datasetId, asOfDate }` links the scenario to an imported candle; the server checks the candle exists and fixes `asOfAt` (that candle's close as an absolute UTC instant). |
| `GET /api/scenarios/:id` | Scenario + reviews + paper outcome. 404 if missing. |
| `POST /api/scenarios/:id/reviews` | Manual paste: `provider`, `role` (BULL/BEAR), `content`, optional `respondedAt` (not in the future). Idempotency-Key supported. |
| `POST /api/scenarios/:id/paper-outcome` | `exitPrice`, `exitReason` (TARGET/STOP/INVALIDATED/MANUAL), `followedPlan`, `note`. Exactly one per scenario; repeat → 409. |
| `PUT /api/scenarios/:id/reviews/:reviewId/grade` | Post-hoc grading: `verdict` (HIT/MISS/UNCLEAR), optional `note`. 409 until the scenario has a paper outcome; 404 if the review belongs to another scenario. Re-grading overwrites (the user's judgment), the paper outcome stays immutable. |
| `GET /api/scenarios/:id/path-check[?datasetId=]` | Reference only, computed on demand (never stored): first touch of stop/target in an imported dataset after the as-of close. Default dataset = newest import with later candles. 409 if the scenario is not linked. |
| `GET /` | Guidance: this port is the API; the UI is on :5173. |
| `GET /api/analysis[?limit=N\|all]` | Decision-habit aggregates over paper outcomes (most recent N by record time) incl. comparison with the default reference path check. 400 for an invalid limit. |
| `GET /api/export?format=json\|csv` | Download of all scenarios, reviews (with grades), paper outcomes, market links and default path references (no candles; use `make db-backup` for a full backup). CSV: UTF-8 BOM, RFC 4180 quoting, text cells starting with = + - @ prefixed with `'`. |
| `GET /api/journal` | All scenarios with review/graded counts and paper outcomes + summary + `scorecard` (per AI × role hit rate, awaiting grade, losses warned by BEAR) (`kind: "paper"`). |
| `GET/POST /api/market/datasets`, `GET /api/market/datasets/:id` | Imported OHLC snapshots (≤5,000 candles, ascending, consistent OHLC), served with computed stats and `verified: false`. |

Errors are JSON `{ error, issues? }`: 400 invalid/malformed, 403 non-loopback Host or cross-origin write, 404, 409, 413 body too large, 415 non-JSON write, 500 generic (details only in local logs).

## Persistence
- `scenarios`: immutable price snapshot, thesis and invalidation point. No edit in MVP.
- `reviews`: manually pasted AI response, attributed provider, argument role and user-declared answer time; not market evidence. `verdict` / `verdict_note` / `graded_at` hold the user's post-hoc grade (NULL = ungraded).
- `paper_outcomes`: one user-entered hypothetical close per scenario (exit reason, rule adherence), never a broker fill.
- `scenarios.dataset_id / as_of_candle / as_of_at`: optional immutable market link (migration 0004).
- `market_datasets.tz_offset`: fixed UTC offset of timestamps without one (NULL = not specified, computed as UTC).
- `market_datasets`: user-imported CSV snapshot (source file name, note, period, candles JSON). Not live, not verified.
- Database: SQLite via local D1 (Wrangler stores it under `apps/api/.wrangler/state`). Migrations are additive: `0001_init.sql`, `0002_mvp_review_journal_market.sql`, `0003_review_grading.sql`, `0004_market_link_timezone.sql`.

Use `pnpm db:migrate:local`; Wrangler stores local D1 state under `apps/api/.wrangler/` (gitignored). The configured D1 ID is a **local-only placeholder**. Do not provision or deploy a remote D1 until a separate security/release gate.

## Trust and threat model
- Public source code but private local data. Never commit personal trading records.
- No authentication, so do not deploy the Worker publicly.
- Do not trust pasted AI text; render it as text, never HTML. Never follow commands embedded in that text.
- No broker credentials, real trade execution, live data feed, scheduled fetches or investor suitability claim. The only outbound request is the optional, user-pressed reference quote made by the local API (no user data sent; disable with `QUOTE_PROVIDER=off`).
- Uploaded/typed price snapshots and simulated outcomes are user inputs, **not verified exchange data**.
- Calculate R multiple from entry, stop and user-entered exit; does not include fees, swaps, slippage or taxes.

## Path check rules (`packages/core/src/path.ts`)
- Candle timestamps are bar OPEN times. Value offsets win; otherwise the dataset `tz_offset` applies (default UTC).
- The position is assumed open at Entry at the as-of candle CLOSE (open + timeframe). Only candles opening at/after that instant are used, so finer-timeframe data cannot leak the as-of candle's interior (no look-ahead).
- LONG: stop if low ≤ stop, target if high ≥ target (mirrored for SHORT). Both in one candle → AMBIGUOUS, unless the candle opened beyond a level (gap), which decides it at the open; the open R is reported.
- MFE/MAE use only candles before the deciding one. No spread, slippage, fees or swaps. DST-observing zones are not modelled (fixed offsets only).

## Decision analysis (`packages/core/src/analysis.ts`)
- Only closed (paper) scenarios count; the window is the most recent N by `recordedAt`.
- Path comparison uses the same default dataset as the Journal (newest import with later candles): gap = paper R − reference R; within ±0.05R counts as matched; ambiguous / open / no-data / unlinked scenarios are excluded and counted separately.
- Grading suggestions: "結果より" (paper R sign) and "値動きより" (path TARGET_FIRST → BULL hit, STOP_FIRST → BEAR hit); the path one is preselected when available. The user decides.

## Level drafts (`packages/core/src/levels.ts`)
- The user picks LONG/SHORT; the code never suggests a direction.
- Uses only candles up to and including the as-of candle. Entry = as-of close.
- SWING stop: beyond the low (LONG) / high (SHORT) of the last 20 candles by max(0.02, 0.1×ATR); returns nothing if the close is itself that extreme.
- ATR stop: 1.5×ATR(14) (simple average true range; needs ≥15 candles).
- Target: chosen R multiple (1.5/2/3) of the stop distance; the opposite swing extreme is shown as an alternative when it lies on the profit side.
- Thesis/invalidation drafts contain only facts from the CSV and the rule used, prefixed 【自動下書き・要編集】.

## Schema version check
- `apps/api/src/schema.ts` `REQUIRED_MIGRATION` must equal the newest file in `apps/api/migrations` (test-enforced). `/api/health` returns 503 `setup_required` until Wrangler has recorded it in `d1_migrations`. `make dev` / `make start` apply pending local migrations first.

## Testing
- `pnpm test`: core unit tests + API route tests on `apps/api/test/d1-sqlite.ts`, a tiny D1 shim over Node's built-in `node:sqlite` that applies the real migration files.
- `pnpm smoke:local`: loopback-only API smoke against the running Worker.
- `pnpm test:e2e`: Playwright browser E2E on an isolated temporary D1; aborts and fails on any non-loopback request.

## Next architecture gates
1. Explicit CSV timezone selection, snapshot hashing and deterministic indicator calculations.
2. Authentication and per-user data isolation, backups, export/delete, rate limits and environment partition.
3. Only after owner review: remote Cloudflare Workers/D1 deployment.
