# TradeCourt — Agent instructions

## Mission
Build and verify a **local-first trading-decision review application**, not a signal provider. A user writes a price/stop/target hypothesis, asks subscribed AI websites to argue *for* and *against* using user-initiated copy/open, stores the manually pasted responses, then records a **paper-trade** outcome.

## Hard boundaries
- **No LLM API keys, billing APIs, session-cookie reuse, browser automation of ChatGPT/Claude/Gemini/Grok, credential scraping or unauthorized subscription automation.** Only copy text, open official websites and paste the response back.
- **No order placement, broker integration, live inventory/finance writes, guarantees of returns or auto-trading** in the MVP. Never label paper data as real executions.
- Never fabricate candles, market prices, AI assessments or test results. All sample data must be clearly labeled synthetic.
- Do not deploy the API publicly. There is no authentication yet. Wrangler must run locally only. Add auth, isolation and deployment safeguards as a separate, reviewed milestone.
- Public repository: do not commit secrets, user trade journals, CSVs, screenshots, private prompts, tokens, .env files or local D1 state.
- No new GitHub Actions workflows by default: control CI usage/cost. Run local tests.
- No unnecessary infra (Containers, Queues, R2, cron jobs, paid market feeds) for MVP.

## Architecture
- pnpm monorepo: `apps/web` Preact/Vite (native `preact` + `preact/hooks`, no compat layer; use `onInput` for text inputs); `apps/api` Hono Cloudflare Worker and local D1; `packages/core` Zod schemas, deterministic R:R math and prompt generation.
- API owns persistence; never let UI read/write D1 directly. Use typed DTOs and validated inputs.
- D1 migrations are additive and versioned in `apps/api/migrations`. Local migrations first. Use parameterized queries.
- Port contracts: web `127.0.0.1:5173`, Worker `127.0.0.1:8787`, Vite proxies `/api`.
- Initially USD/JPY only, LONG/SHORT and 1h/4h/1d; extend via explicit contracts. A scenario becomes an immutable snapshot after creation.
- Store AI responses **only after manual paste**, with provider and BULL/BEAR role metadata. An AI review is commentary, never verified market evidence.
- An outcome is **user-entered paper data**, not an externally confirmed trade or broker fill. Keep this distinction in DB and UI.

## Verify before declaring complete
1. `corepack pnpm install` and `corepack pnpm db:migrate:local`.
2. `corepack pnpm test && corepack pnpm typecheck && corepack pnpm build`.
3. `corepack pnpm dev`; GET `/api/health`, create & list a synthetic scenario, generate both prompts, paste and persist a review, record a paper outcome, reload and verify persistence.
4. Check invalid stop/target, missing fields, missing ID, repeated outcome, and no external AI/broker call.
5. Report PASS/FAIL/NOT RUN with exact commands, environment, and evidence; no assumed success.

Shortcuts (macOS/Linux): `make verify` covers 1–2 plus the isolated browser E2E; `make start`, `make smoke`, `make e2e-dev`, `make stop` cover 3–4 against the running app. Run `make` for all targets.

## Change discipline
- Read README, docs/ARCHITECTURE.md, docs/ROADMAP.md first.
- Small cohesive PRs; note risks and verification. Don't silently widen scope into auto-execution or OAuth.
- Respect existing user work, no force pushes, no production deployments. Update documentation when contract or command changes.
