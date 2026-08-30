.PHONY: install dev reset check test test-e2e lint format docs build package help

install: ## Install dependencies and the Electron binary
	@pnpm install --frozen-lockfile

dev: install ## Start the Electron app (DEMO=1 opens the demo workspace)
ifeq ($(DEMO),1)
	@TELO_DEMO_WORKSPACE=1 pnpm dev
else
	@pnpm dev
endif

reset: ## Delete Electron user data and return to first-run state
	@node scripts/reset-userdata.mjs

check: ## Run formatting, lint, types, tests, docs, and Electron E2E tests
	@pnpm check

test: ## Run unit and integration tests
	@pnpm test

test-e2e: ## Run Electron end-to-end tests
	@pnpm test:e2e

lint: ## Run ESLint
	@pnpm lint

format: ## Format source and documentation
	@pnpm format

docs: ## Validate documentation
	@pnpm docs:check

build: ## Build main, preload, and renderer bundles
	@pnpm build

package: ## Build unpacked application artifacts
	@pnpm package

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'
