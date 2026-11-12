# TradeCourt

A local-first **trade-decision review workspace**. Record a hypothetical USD/JPY scenario, compute its risk/reward, ask your existing AI subscriptions for opposing arguments via **copy + open official site**, paste their replies back, and compare with a manually recorded **paper-trade** outcome.

トレード仮説をAIに反証させ、仮想取引の結果と比較するローカル専用アプリです。

**Not included (by design):** AI API keys, browser automation of AI sites, session cookies, broker integration, order execution, live market data, trading signals or return claims. Paper outcomes are user-entered, never broker fills.

## Screens

| Screen | What it does |
| --- | --- |
| **01 Market Lens** | Import a local OHLC CSV (USD/JPY, `date,open,high,low,close`, ascending, ≤5,000 rows, ≤2 MB). Shows close-price chart, period high/low (with dates), change and % change, data period, source file and import time. Invalid / oversized CSV is rejected. Imported snapshots persist in local D1, flagged `verified: false`. No live prices. |
| **02 Scenario** | LONG/SHORT, 1h/4h/1d, Entry/Stop/Target with live R:R and direction check, entry thesis and invalidation condition. Saved scenarios are immutable and listed. |
| **03 AI Court** | Generates BULL (賛成) / BEAR (反対) prompts from the saved scenario, one-click copy, opens the official ChatGPT / Claude / Gemini / Grok site in a new tab. You paste the answer back; provider, role, answer time and save time are stored. BULL vs BEAR side-by-side comparison and provider × role matrix. Pasted text is rendered as plain text (never HTML). |
| **04 Journal** | Shows the scenario snapshot and its AI reviews, records one immutable paper exit (price, exit reason, rule adherence, reflection), computes the R multiple, compares plan vs. actual decision, and lists the full decision history with paper-only summary stats. |

## Quick start (Node 22+, pnpm via corepack)

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm db:migrate:local
corepack pnpm dev
```

- Web: http://127.0.0.1:5173 (Vite, proxies `/api` to the Worker)
- API: http://127.0.0.1:8787/api/health (Wrangler local, D1 state in `apps/api/.wrangler/`, gitignored)

## Commands

| Command | Purpose |
| --- | --- |
| `corepack pnpm test` | Vitest: `packages/core` (schemas, R:R, R multiple, prompts, CSV parsing/stats) and `apps/api` (all routes against the real migrations on an in-memory `node:sqlite` D1 shim: validation, 400/404/409/413/415/403, idempotency, journal, market). |
| `corepack pnpm typecheck` | `tsc --noEmit` for all packages. |
| `corepack pnpm build` | Production build of the web app. |
| `corepack pnpm db:migrate:local` | Apply D1 migrations to the **local** database only. |
| `corepack pnpm smoke:local` | With `pnpm dev` running: synthetic API smoke against `127.0.0.1:8787` (writes synthetic rows to your local D1). |
| `corepack pnpm test:e2e` | Playwright/Chromium browser E2E of the full flow on an **isolated** temporary D1 (API :8798, web :5183); temp state is deleted afterwards. Set `TRADECOURT_E2E_BASE_URL=http://127.0.0.1:5173` to run against your running `pnpm dev` instead. Screenshots go to `test-results/` (gitignored). On a new machine run `corepack pnpm exec playwright install chromium` once. |

The browser E2E blocks and fails on any non-loopback request. It checks external AI links' `href`/`target`/`rel` but never opens, logs into or automates an AI site.

## Verification results

Executed in a Linux cloud container on 2026-11-12 (Node v22.23.4, pnpm 10.23.0 via corepack 0.36.0, wrangler 4.160.1, Chromium via Playwright 1.63.0). The exact Git SHA is recorded in the pull request.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` (fresh `node_modules`) | PASS |
| `pnpm test` — core 22 tests, api 21 tests | PASS |
| `pnpm typecheck` | PASS |
| `pnpm build` | PASS |
| `pnpm db:migrate:local` (0001, 0002) | PASS |
| `pnpm dev` → `GET /api/health` on :8787 and via :5173 proxy | PASS |
| `pnpm smoke:local` | PASS |
| `pnpm test:e2e` isolated, 12 steps (CSV import + rejection, scenario + R:R, BULL/BEAR prompt + clipboard copy, official links, 2 pasted synthetic reviews compared, HTML not executed, paper exit + R multiple, API error paths, reload persistence, mobile 390px for 4 screens, zero external requests) | PASS 12/12 |
| Same E2E against running `pnpm dev` (:5173/:8787, real local D1) | PASS 12/12 |
| Data persists after stopping and restarting `pnpm dev` | PASS |
| Logging into / sending prompts to real ChatGPT, Claude, Gemini, Grok | **NOT RUN** (intentionally manual; not automatable by policy) |
| Owner's own workstation (macOS/Windows) fresh clone | **NOT RUN** here |

## Security

Local development only. **No authentication.** The Worker binds to `127.0.0.1`, rejects non-loopback `Host` headers and cross-origin writes, requires `application/json` for writes and limits body size. Do **not** deploy this API publicly until authentication, access controls, backups and secret handling are in place. There is intentionally no deployment script and no GitHub Actions workflow.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/ROADMAP.md`](docs/ROADMAP.md) and [`AGENTS.md`](AGENTS.md).
