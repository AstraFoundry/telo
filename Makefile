.PHONY: install tdlib dev demo reset check fmt vet test test-live parity arch capabilities generated docs snapshots build package tdapi copy inventory help

GO ?= go
# A developer's Telegram and OAuth credentials (copy .env.example).
ifneq (,$(wildcard .env))
include .env
export
endif
# Pure Go: MyGo and the TDLib binding (purego) need no C toolchain.
export CGO_ENABLED = 0

install: ## Install the documentation tooling and the pinned TDLib build
	@pnpm install --frozen-lockfile

tdlib: install ## Stage libtdjson for this platform under build/tdlib-native
	@pnpm tdlib:stage

dev: tdlib ## Run Telo against Telegram (TELO_TELEGRAM_API_ID/HASH); DEMO=1 opens the demo workspace
ifeq ($(DEMO),1)
	@TELO_DEMO=1 $(GO) tool mygo dev
else
	@$(GO) tool mygo dev
endif

demo: ## Run Telo on the demo workspace
	@$(MAKE) dev DEMO=1

reset: ## Run Telo once with an empty, throwaway profile
	@TELO_DATA_DIR=$$(mktemp -d) $(GO) tool mygo dev

check: tdlib fmt vet generated arch capabilities parity test docs ## Run every gate CI runs

fmt: ## Fail on unformatted Go
	@out=$$(gofmt -l backend frontend bootstrap cmd internal main.go); \
	if [ -n "$$out" ]; then echo "gofmt needed:"; echo "$$out"; exit 1; fi

vet: ## Run go vet
	@$(GO) vet ./...

test: tdlib ## Run the Go tests against the staged libtdjson
	@TELO_REQUIRE_TDLIB=1 $(GO) test ./...

test-live: tdlib ## Drive docs/telegram/baseline.md on a signed-in account (TELO_LIVE_E2E=1, TELO_LIVE_DIR)
	@TELO_REQUIRE_TDLIB=1 $(GO) test -run TestLiveBaseline -v ./backend/infrastructure/telegram/live

parity: ## telegram-macos parity gate: ledger, evidence, tests and registry anchors
	@$(GO) run ./cmd/paritycheck

arch: ## FSD and DDD import rules
	@$(GO) run ./cmd/archcheck

capabilities: ## TDLib capability matrix against the generated bindings
	@$(GO) run ./cmd/capabilitycheck

generated: ## Fail when generated Go (copy keys, TDLib bindings) is stale
	@$(GO) run ./cmd/copygen -check
	@$(GO) run ./cmd/tdgen -check

docs: install ## Lint the documentation and resolve its links and make targets
	@pnpm docs:check
	@$(GO) run ./cmd/doccheck

snapshots: ## Render UI test snapshots to .workspace/snapshots for review
	@TELO_UI_SNAPSHOTS=$(CURDIR)/.workspace/snapshots $(GO) test ./frontend/...

build: ## Build the Telo binary for this platform
	@$(GO) build -o build/telo .

# A release links the Telegram API credentials and the Google OAuth client.
BOOT = github.com/AstraFoundry/telo/bootstrap
LDFLAGS = -X $(BOOT).apiID=$(TELO_TELEGRAM_API_ID) -X $(BOOT).apiHash=$(TELO_TELEGRAM_API_HASH) -X $(BOOT).googleClientID=$(TELO_GOOGLE_OAUTH_CLIENT_ID)

package: tdlib ## Build the packaged app for this platform with mygo, linking the release credentials
	@MYGO_LDFLAGS="$(LDFLAGS)" $(GO) tool mygo build

tdapi: ## Regenerate the TDLib bindings from td_api.tl and tdapi.list
	@$(GO) generate ./backend/infrastructure/tdlib/tdapi

copy: ## Regenerate the copy keys from en.copy
	@$(GO) generate ./frontend/shared/copy

inventory: ## Refresh the telegram-macos inventory (UPSTREAM=path to a checkout)
	@$(GO) run ./cmd/parityinventory -upstream "$(UPSTREAM)"

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-13s %s\n", $$1, $$2}'
