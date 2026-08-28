.PHONY: dev check test test-e2e lint format docs build package help

dev: ## Start the Electron app in development mode
	@pnpm dev

check: ## Run formatting, lint, types, tests, docs, and production build
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
