# Verification record

How TradeCourt is verified, and the latest recorded results. Re-run with `make verify` (install, migrate, unit/route tests, typecheck, build, isolated browser E2E) plus `make start && make smoke && make e2e-dev` against the running app. Report each check as PASS / FAIL / NOT RUN with evidence; never assume success.

## Results

Latest run: 2026-11-13, Linux cloud container (Node v22.23.4, pnpm 10.23.0 via corepack 0.36.0, wrangler 4.160.1, Chromium via Playwright 1.63.0). The exact Git SHA is recorded in the pull request.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` (fresh `node_modules`) | PASS |
| `pnpm test` — core 57 tests, api 49 tests | PASS |
| `pnpm typecheck` / `pnpm build` | PASS |
| `pnpm db:migrate:local` — 0003 applied on top of an already populated local DB; existing rows intact (ungraded) | PASS |
| `pnpm dev` → `GET /api/health` on :8787 and via :5173 proxy | PASS |
| `pnpm smoke:local` (incl. grading, root guidance, market link + path check, analysis, CSV/JSON export) | PASS |
| `pnpm test:e2e` isolated, 18 steps (previous 12 + review grading on desktop + phone 390×844 touch flow: bottom tab bar stays pinned, scenario picker, tap grading, sticky message, card tables, no horizontal overflow; + required CSV timezone, scenario linked to an as-of candle, path check STOP first with chart markers and high-low ranges, R difference and exit-reason mismatch vs paper outcome, reload; + path-based grading suggestion, Insights aggregates, CSV/JSON download, five screens on a phone with no table spilling out of its card; + auto-drafted levels from CSV, R buttons, one-tap outcome with cancel/confirm on desktop and 390px touch; + English UI from the browser locale, English prompt and CSV errors, EN/日本語 switch persisted across reloads, five phone screens in English without overflow) | PASS 18/18 |
| Same E2E against running `pnpm dev` (:5173/:8787, real local D1) | PASS 18/18 |
| Grades and all data persist after stopping and restarting `pnpm dev` | PASS |
| Make targets: `start`/`stop`/`restart`/`status`/`logs`, port-conflict and unmigrated-DB refusal, no leftover processes after `stop` | PASS |
| `make db-backup` → `db-reset CONFIRM=yes` (empty) → `db-restore` returns identical counts (14 scenarios / 13 reviews / 5 graded / 7 datasets) | PASS |
| `make verify` (setup + test + typecheck + build + isolated E2E 18/18) | PASS |
| Real "Get current price" in the browser: Entry set to the ECB reference rate (159.7, 2026-11-12) with date/source; the browser made 0 non-loopback requests (the local API fetched it) | PASS |
| Health reports pending migrations (DB at 0003 → 503 with `make migrate` hint); `make start` auto-applies them | PASS |
| Migration 0004 on an already populated local DB (17 existing scenarios intact, unlinked); market links persist across `make restart` | PASS |
| `GET http://127.0.0.1:8787/` explains the UI is on :5173 (localhost guard applies) | PASS |
| Logging into / sending prompts to real ChatGPT, Claude, Gemini, Grok | **NOT RUN** (intentionally manual; not automatable by policy) |
| Real phone hardware (iOS Safari / Android Chrome) | **NOT RUN** (emulated 390×844 touch viewport in Chromium only) |
| Owner's own workstation (macOS/Windows) fresh clone | **NOT RUN** here |

The browser E2E also runs once with an English browser locale (UI, AI prompt and CSV errors in English, language switch persisted across reloads, five phone screens without overflow) — see `scripts/e2e-browser.mjs`.
