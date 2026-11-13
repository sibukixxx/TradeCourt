# TradeCourt

**English** | [日本語](README.ja.md)

A local-first **trade-decision review workspace**. Write down a trade hypothesis *before* you act, have your existing AI subscriptions argue **for and against** it (via copy and paste, no API keys), record a **paper-trade** outcome, and learn from the gap between plan and result.

> **Not a signal service.** TradeCourt never tells you to buy or sell, never places orders, never connects to a broker and never pretends to have live prices. All outcomes are user-entered paper trades. Nothing here is investment advice.

The UI is available in **English and Japanese** (auto-detected from your browser, switchable at any time).

## What you can do

| Screen | Purpose |
| --- | --- |
| **01 Market Lens** | Import your own OHLC CSV (USD/JPY, `date,open,high,low,close`, ≤5,000 rows, ≤2 MB). See the close-price chart, period high/low and change. The CSV timezone is an explicit choice at import. Bad or oversized files are rejected. There is no live feed. |
| **02 Scenario** | LONG/SHORT, 1h/4h/1d, Entry/Stop/Target with a live risk/reward preview, thesis and invalidation condition. A saved scenario is immutable. You can optionally link it to the imported candle you formed it at ("as of"). Pick only the direction and an **auto draft** fills Entry, Stop (beyond the recent swing or 1.5×ATR) and Target (1.5/2/3R) using fixed rules on past candles; the draft is clearly labelled and is never a recommendation. **R buttons** set the target from Entry/Stop. Entry defaults to the latest imported close. |
| **03 AI Court** | Generates BULL (for) and BEAR (against) prompts in your UI language. Copy one, open ChatGPT / Claude / Gemini / Grok on its official site, and paste the answer back. Provider, role and time are stored, and answers are compared side by side. Pasted text is always rendered as plain text. |
| **04 Journal** | Record one immutable paper exit, either with a **one-tap** button (target / stop / entry, plus a confirm tap) or at any other price. The R multiple is computed, and plan vs. decision is compared. **Path check:** for linked scenarios, see which level your own later CSV touched first (no look-ahead; a candle touching both levels is "ambiguous"). **Grade the AI reviews** (hit / miss / unclear) against the result. |
| **05 Insights** | Decision-habit analysis of your paper records: average R, win rate, drawdown, rules followed vs. broken, R left on the table vs. saved compared with the CSV path, and hit rate by AI. Export everything as CSV or JSON. |

Works on phones as well: bottom tab bar, card tables and 44px touch targets.

## Quick start

Requirements: Node.js 22+ (with corepack) on macOS or Linux (Windows: use WSL).

```bash
make setup    # install locked dependencies and create the local SQLite (D1) database
make seed     # optional: load SYNTHETIC demo data near the recent USD/JPY level (starts the app)
make start    # start API + web in the background and wait until healthy
make open     # open http://127.0.0.1:5173
make stop     # stop everything
```

- Web UI: http://127.0.0.1:5173
- Local API: http://127.0.0.1:8787/api/health (no UI on this port)
- Run `make` to list all targets. Without make: `corepack pnpm install --frozen-lockfile && corepack pnpm db:migrate:local && corepack pnpm dev`.

## Seed data for local development

`make seed` fills an **empty** local database with deterministic, clearly labelled **SYNTHETIC** data, so every screen has something to show:
- 120 daily USD/JPY candles. The last close is anchored to the latest ECB reference rate (159.7 on 2026-11-12), and the walk is scaled to the recent real range (153.27–160.16).
- 8 scenarios (linked and unlinked), placeholder AI reviews (marked "not an AI answer"), 5 paper outcomes (followed and broken rules), grades, and two open scenarios for trying the one-tap record.

Options:
- `make seed ANCHOR=live` anchors to today's reference quote via the running API; `ANCHOR=150.25` sets the anchor explicitly.
- `make seed FORCE=1` adds the data even if the database already has scenarios.
- `make reseed CONFIRM=yes` backs up, resets the database and seeds it again, for a fresh dev environment. **This deletes your local data**, so only use it on a dev database.

The candles are a seeded random walk, not real prices. Everything goes through the normal API validation (`scripts/seed-local.mjs`).

## Languages

- English and Japanese are included. The initial language follows the browser (`ja*` → Japanese, otherwise English). The **EN / 日本語** switch in the top bar remembers your choice.
- AI prompts and auto-draft texts are generated in the selected language.
- **Adding a language** means:
  1. Add `apps/web/src/i18n/<lang>.ts` typed against `ja.ts`; a missing key is a compile error.
  2. Extend `Lang` in `packages/core/src/lang.ts`.
  3. Add prompt and draft templates in `packages/core` (`buildReviewPrompt`, `draftLevels`).

## Optional reference quote ("Get current price")

- Only when you press the button, the local API fetches the **European Central Bank daily USD/JPY reference rate** from api.frankfurter.dev.
  - It sends no key and no user data, uses a 5 s timeout and validates the response.
  - The value is not a live or tradeable price, and the UI shows its date.
- To disable all external requests, put `QUOTE_PROVIDER=off` in `apps/api/.dev.vars` (gitignored) and run `make restart`.

## Make targets

| Group | Targets |
| --- | --- |
| Setup | `setup`, `install` (frozen lockfile), `migrate` (local only), `seed`, `reseed CONFIRM=yes` |
| Run | `dev` (foreground), `start` / `stop` / `restart` / `status` / `logs` (background), `open` |
| Quality | `test`, `typecheck`, `build`, `check`, `smoke`, `e2e` (isolated temp DB), `e2e-dev`, `verify` |
| Local data | `db-backup`, `db-restore FILE=…`, `db-reset CONFIRM=yes` (each writes a safety backup first) |

Background state (`.run/`) and backups (`backups/`) are gitignored because they may contain your personal trading journal.

## Testing

- `make test`: Vitest unit tests (`packages/core`) and API route tests against the real migrations on an in-memory SQLite.
- `make e2e`: Playwright browser E2E of the whole flow on an isolated temporary database, in Japanese and English and at phone size. It fails on any external network request and never opens or automates AI websites.
- Latest results are in [docs/VERIFICATION.md](docs/VERIFICATION.md). On a new machine, run `corepack pnpm exec playwright install chromium` once before `make e2e`.

## Project layout

```text
apps/web       Preact + Vite UI (i18n in src/i18n)
apps/api       Hono on the Cloudflare Workers runtime, run locally by Wrangler; SQLite via local D1
packages/core  Zod contracts, R:R / R-multiple math, path check, analysis, prompts
scripts/       dev control, smoke test, browser E2E
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/ROADMAP.md](docs/ROADMAP.md).

## Security

TradeCourt is for **local use only** and has **no authentication**.
- The API binds to `127.0.0.1` and rejects non-loopback `Host` headers and cross-origin writes.
- Writes must be JSON, and request bodies are size-limited.
- Do not deploy it publicly until authentication, access control and backups exist.
- There is no deployment script and no CI workflow by design.

## Contributing

Issues and pull requests are welcome.
- Read [AGENTS.md](AGENTS.md) for the project boundaries: no AI API keys or browser automation, no order execution, no fabricated data.
- Keep pull requests small, and run `make verify` before opening one.
- Never commit secrets, real trading journals, CSV exports or local database state.

## License

[MIT](LICENSE). The software is provided "as is", without warranty of any kind. It is a decision-review tool, not financial advice; you are solely responsible for your trading decisions.
