# TradeCourt — local development commands. LOCAL ONLY: nothing here deploys or calls remote services.
# Requires Node 22+ (corepack) and GNU/BSD make on macOS or Linux. Run `make` for the list.

PNPM ?= corepack pnpm
DEVCTL := node scripts/devctl.mjs

.DEFAULT_GOAL := help
.PHONY: help setup install migrate dev api web start stop restart status logs logs-follow open \
        test typecheck build check smoke e2e e2e-dev verify db-backup db-restore db-reset clean

help: ## Show this help
	@echo "TradeCourt (local only)  Web http://127.0.0.1:5173  API http://127.0.0.1:8787"
	@echo ""
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2} /^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5)}' $(MAKEFILE_LIST)

##@ Setup
setup: install migrate ## First-time setup: install dependencies and migrate the local DB

install: ## Install dependencies exactly as locked (pnpm-lock.yaml)
	$(PNPM) install --frozen-lockfile

migrate: ## Apply D1 (SQLite) migrations to the LOCAL database
	$(PNPM) db:migrate:local

##@ Run
dev: migrate ## Apply pending local migrations, then run API + Web in the foreground (Ctrl+C to stop)
	$(PNPM) dev

api: ## Run only the API Worker (:8787) in the foreground
	$(PNPM) --filter @tradecourt/api dev

web: ## Run only the Vite web app (:5173) in the foreground (needs the API)
	$(PNPM) --filter @tradecourt/web dev

start: ## Apply pending local migrations, start API + Web in the background, wait until healthy
	@$(DEVCTL) running >/dev/null 2>&1 || $(PNPM) db:migrate:local >/dev/null
	@$(DEVCTL) start

stop: ## Stop the background servers started by `make start`
	@$(DEVCTL) stop

restart: ## Restart the background servers
	@$(DEVCTL) restart

status: ## Show process and health status of API / Web
	@$(DEVCTL) status

logs: ## Show the last 100 lines of the background server log
	@test -f .run/dev.log && tail -n 100 .run/dev.log || echo "No log yet (.run/dev.log). Run make start."

logs-follow: ## Follow the background server log (Ctrl+C to quit)
	@test -f .run/dev.log && tail -n 50 -f .run/dev.log || echo "No log yet (.run/dev.log). Run make start."

open: ## Open the web app in the default browser
	@url=http://127.0.0.1:5173; (command -v open >/dev/null && open $$url) || (command -v xdg-open >/dev/null && xdg-open $$url) || echo $$url

##@ Quality
test: ## Unit + API route tests (Vitest)
	$(PNPM) test

typecheck: ## TypeScript type check for all packages
	$(PNPM) typecheck

build: ## Production build of the web app
	$(PNPM) build

check: test typecheck build ## test + typecheck + build

smoke: ## API smoke test against the running local API (writes synthetic rows)
	@curl -sf http://127.0.0.1:8787/api/health >/dev/null || { echo "API is not running. Run make start first."; exit 1; }
	$(PNPM) smoke:local

e2e: ## Browser E2E on an isolated temporary DB (does not touch your data)
	$(PNPM) test:e2e

e2e-dev: ## Browser E2E against the running app (writes synthetic rows to your DB)
	@curl -sf http://127.0.0.1:5173/api/health >/dev/null || { echo "App is not running. Run make start first."; exit 1; }
	TRADECOURT_E2E_BASE_URL=http://127.0.0.1:5173 TRADECOURT_E2E_OUT=test-results/e2e-dev node scripts/e2e-browser.mjs

verify: setup check e2e ## Full local verification: setup, test, typecheck, build, isolated E2E

##@ Local database (SQLite via Wrangler D1, apps/api/.wrangler/state)
db-backup: ## Export the local DB to backups/tradecourt-backup-<time>.sql
	@$(DEVCTL) db-backup

db-restore: ## Replace the local DB with FILE=backups/<file>.sql (auto-backup first; server must be stopped)
	@$(DEVCTL) db-restore $(FILE)

db-reset: ## Delete ALL local data and re-migrate (needs CONFIRM=yes; auto-backup first; server must be stopped)
	@if [ "$(CONFIRM)" != "yes" ]; then echo "This deletes all local TradeCourt data (a backup is taken first). Run: make db-reset CONFIRM=yes"; exit 1; fi
	@$(DEVCTL) db-reset

##@ Cleanup
clean: ## Remove build output and test artifacts (keeps node_modules, data and backups)
	rm -rf apps/web/dist test-results playwright-report .run/dev.log
