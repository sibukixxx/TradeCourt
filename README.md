# TradeCourt

A local-first **trade-decision review workspace**. Record a hypothetical FX scenario, compute its risk/reward, ask your existing AI subscriptions for opposing arguments via **copy + open**, save their replies, and compare with a manually recorded paper-trade outcome.

**Status:** initial scaffold. No AI API keys, broker integrations, order execution, trading signals or claims of investment returns.

## MVP
- One initial market: USD/JPY, long/short, 1h / 4h / 1d.
- Scenario input with directional stop/target validation and deterministic R:R.
- Bull and bear AI review prompts, with manually copied replies (ChatGPT/Claude/Gemini/Grok).
- Immutable scenario snapshot and manual paper-trade outcome (clearly not verified market data).
- Hono on Cloudflare Workers + **local** D1 (SQLite), React/Vite frontend.

## Quick start (Node 22+, pnpm)
```bash
corepack enable
pnpm install
pnpm db:migrate:local
pnpm dev
```
Visit `http://127.0.0.1:5173`. API health: `http://127.0.0.1:8787/api/health`.

Run `pnpm test && pnpm typecheck && pnpm build` after installing dependencies. See `docs/ARCHITECTURE.md` and `AGENTS.md` for boundaries.

**Security:** Local development only. No authentication is implemented. Do **not** deploy this API publicly until authentication, access controls, origin protection, data backup and secret-handling are in place. There is intentionally no deployment script or GitHub Actions workflow.
