# TradeCourt

A local-first **trade-decision review workspace**. Record a hypothetical USD/JPY scenario, compute its risk/reward, ask your existing AI subscriptions for opposing arguments via **copy + open official site**, paste their replies back, and compare with a manually recorded **paper-trade** outcome.

トレード仮説をAIに反証させ、仮想取引の結果と比較するローカル専用アプリです。

**Not included (by design):** AI API keys, browser automation of AI sites, session cookies, broker integration, order execution, live market data, trading signals or return claims. Paper outcomes are user-entered, never broker fills.

## Screens

| Screen | What it does |
| --- | --- |
| **01 Market Lens** | Import a local OHLC CSV (USD/JPY, `date,open,high,low,close`, ascending, ≤5,000 rows, ≤2 MB). Shows close-price chart, period high/low (with dates), change and % change, data period, source file and import time. Invalid / oversized CSV is rejected. Imported snapshots persist in local D1, flagged `verified: false`. No live prices. The timezone of the CSV timestamps is a required choice at import (fixed UTC offset such as JST +09:00, or "unknown" = treated as UTC and flagged). |
| **02 Scenario** | LONG/SHORT, 1h/4h/1d, Entry/Stop/Target with live R:R and direction check, entry thesis and invalidation condition. Saved scenarios are immutable and listed. Optionally link the scenario to an imported CSV candle ("as-of": the hypothesis is formed at that candle's close); the form shows the as-of close, can copy it into Entry and charts the levels. The link is part of the immutable snapshot. |
| **03 AI Court** | Generates BULL (賛成) / BEAR (反対) prompts from the saved scenario, one-click copy, opens the official ChatGPT / Claude / Gemini / Grok site in a new tab. You paste the answer back; provider, role, answer time and save time are stored. BULL vs BEAR side-by-side comparison and provider × role matrix. Pasted text is rendered as plain text (never HTML). |
| **04 Journal** | Shows the scenario snapshot and its AI reviews, records one immutable paper exit (price, exit reason, rule adherence, reflection), computes the R multiple, compares plan vs. actual decision, and lists the full decision history with paper-only summary stats. |
| **答え合わせ (in Journal)** | After the paper exit is recorded, grade each pasted AI review as 的中 / 外れ / 判定不能 with an optional note (suggestion: profit → BULL hit, loss → BEAR hit; you decide, and can re-grade). A scorecard shows hit rate per AI × BULL/BEAR (判定不能 excluded), reviews awaiting a grade, and losses where a BEAR warning was graded a hit. Grades are your own judgment against paper results, not market verification. |
| **値動きとの照合 (in Journal)** | For linked scenarios: which level (stop or target) the user's own CSV touched first after the as-of close, the candle it happened on, R, max favourable/adverse excursion before it, gap-through-level warnings, and a chart with levels, as-of and deciding-candle markers. Pick any imported dataset with later candles (finer timeframes allowed). Compared with your paper outcome (R difference, exit-reason mismatch). Reference only: computed on demand from unverified CSV; one candle spanning both levels is reported as 判定不能; no look-ahead, spread, fees or swaps. |
| **05 Insights** | Decision-habit analysis over your paper records (all / last 50 / 20 / 10): average & total R, win rate, max drawdown, losses beyond −1R, cumulative-R chart, results when you followed vs broke your rules, by exit reason and side, and — for scenarios linked to market data — how your exits compared with the CSV path (target reached but exited early: R left on the table; exited before the stop: R saved; exited beyond the stop). CSV / JSON export of all records (CSV is spreadsheet-safe: UTF-8 BOM, formula-injection guard). Everything is labelled paper / reference, not performance or advice. |

**Phone UI (≤760px):** bottom tab bar (safe-area aware), scenario picker on AI Court / Journal, tables shown as stacked cards, 44px touch targets, 16px inputs (no iOS zoom on focus), sticky success/error messages.

## Quick start (Node 22+, macOS / Linux)

```bash
make setup    # install locked dependencies + migrate the local SQLite (D1) database
make start    # start API + Web in the background and wait until healthy
make open     # open http://127.0.0.1:5173
make stop     # stop everything
```

- Web: http://127.0.0.1:5173 (Vite, proxies `/api` to the Worker)
- API: http://127.0.0.1:8787/api/health (Wrangler local, SQLite/D1 state in `apps/api/.wrangler/`, gitignored)
- Run `make` to list every target. Without make: `corepack pnpm install --frozen-lockfile && corepack pnpm db:migrate:local && corepack pnpm dev`.

## Make targets

| Group | Targets |
| --- | --- |
| Setup | `make setup` (= `install` + `migrate`), `make install` (`--frozen-lockfile`), `make migrate` (local only) |
| Run (foreground) | `make dev` (API + Web, Ctrl+C to stop), `make api`, `make web` |
| Run (background) | `make start` (waits for both health checks; refuses if ports 8787/5173 are taken or the DB is not migrated), `make stop` (stops the whole process group, no leftover workerd/vite), `make restart`, `make status`, `make logs`, `make logs-follow`, `make open` |
| Quality | `make test`, `make typecheck`, `make build`, `make check` (all three), `make smoke` (needs `make start`), `make e2e` (isolated temp DB), `make e2e-dev` (against the running app), `make verify` (setup + check + e2e) |
| Local database | `make db-backup` → `backups/tradecourt-backup-<time>.sql`; `make db-restore FILE=backups/<file>.sql`; `make db-reset CONFIRM=yes` (deletes all local data). Restore and reset require the server to be stopped and always write a safety backup first. |
| Cleanup | `make clean` (build output, test artifacts, log; keeps data, backups, node_modules) |

Background state lives in `.run/` (PID + `dev.log`); backups in `backups/`. Both are gitignored because they can contain your personal trade journal. Background control is implemented in `scripts/devctl.mjs` (POSIX process groups; macOS / Linux).

## pnpm scripts (used by the Makefile)

| Command | Purpose |
| --- | --- |
| `corepack pnpm test` | Vitest: `packages/core` (schemas, R:R, R multiple, prompts, CSV parsing/stats, grading suggestion/scorecard) and `apps/api` (all routes against the real migrations on an in-memory `node:sqlite` D1 shim: validation, 400/404/409/413/415/403, idempotency, grading, journal, market). |
| `corepack pnpm typecheck` | `tsc --noEmit` for all packages. |
| `corepack pnpm build` | Production build of the web app. |
| `corepack pnpm db:migrate:local` | Apply D1 migrations to the **local** database only. |
| `corepack pnpm smoke:local` | With `pnpm dev` running: synthetic API smoke against `127.0.0.1:8787` (writes synthetic rows to your local D1). |
| `corepack pnpm test:e2e` | Playwright/Chromium browser E2E of the full flow on an **isolated** temporary D1 (API :8798, web :5183); temp state is deleted afterwards. Set `TRADECOURT_E2E_BASE_URL=http://127.0.0.1:5173` to run against your running `pnpm dev` instead. Screenshots go to `test-results/` (gitignored). On a new machine run `corepack pnpm exec playwright install chromium` once. |

The browser E2E blocks and fails on any non-loopback request. It checks external AI links' `href`/`target`/`rel` but never opens, logs into or automates an AI site.

## Verification results

Latest run: 2026-11-12, Linux cloud container (Node v22.23.4, pnpm 10.23.0 via corepack 0.36.0, wrangler 4.160.1, Chromium via Playwright 1.63.0). The exact Git SHA is recorded in the pull request.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` (fresh `node_modules`) | PASS |
| `pnpm test` — core 48 tests, api 39 tests | PASS |
| `pnpm typecheck` / `pnpm build` | PASS |
| `pnpm db:migrate:local` — 0003 applied on top of an already populated local DB; existing rows intact (ungraded) | PASS |
| `pnpm dev` → `GET /api/health` on :8787 and via :5173 proxy | PASS |
| `pnpm smoke:local` (incl. grading, root guidance, market link + path check, analysis, CSV/JSON export) | PASS |
| `pnpm test:e2e` isolated, 16 steps (previous 12 + 答え合わせ on desktop + phone 390×844 touch flow: bottom tab bar stays pinned, scenario picker, tap grading, sticky message, card tables, no horizontal overflow; + required CSV timezone, scenario linked to an as-of candle, path check STOP first with chart markers and high-low ranges, R difference and exit-reason mismatch vs paper outcome, reload; + path-based grading suggestion, Insights aggregates, CSV/JSON download, five screens on a phone with no table spilling out of its card) | PASS 16/16 |
| Same E2E against running `pnpm dev` (:5173/:8787, real local D1) | PASS 16/16 |
| Grades and all data persist after stopping and restarting `pnpm dev` | PASS |
| Make targets: `start`/`stop`/`restart`/`status`/`logs`, port-conflict and unmigrated-DB refusal, no leftover processes after `stop` | PASS |
| `make db-backup` → `db-reset CONFIRM=yes` (empty) → `db-restore` returns identical counts (14 scenarios / 13 reviews / 5 graded / 7 datasets) | PASS |
| `make verify` (setup + test + typecheck + build + isolated E2E 16/16) | PASS |
| Migration 0004 on an already populated local DB (17 existing scenarios intact, unlinked); market links persist across `make restart` | PASS |
| `GET http://127.0.0.1:8787/` explains the UI is on :5173 (localhost guard applies) | PASS |
| Logging into / sending prompts to real ChatGPT, Claude, Gemini, Grok | **NOT RUN** (intentionally manual; not automatable by policy) |
| Real phone hardware (iOS Safari / Android Chrome) | **NOT RUN** (emulated 390×844 touch viewport in Chromium only) |
| Owner's own workstation (macOS/Windows) fresh clone | **NOT RUN** here |

## Security

Local development only. **No authentication.** The Worker binds to `127.0.0.1`, rejects non-loopback `Host` headers and cross-origin writes, requires `application/json` for writes and limits body size. Do **not** deploy this API publicly until authentication, access controls, backups and secret handling are in place. There is intentionally no deployment script and no GitHub Actions workflow.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/ROADMAP.md`](docs/ROADMAP.md) and [`AGENTS.md`](AGENTS.md).
