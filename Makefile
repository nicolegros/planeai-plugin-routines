PLUGIN := planeai-plugin-routines
DIST := dist/$(PLUGIN)
UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)

ifeq ($(OS),Windows_NT)
  PLATFORM := windows-x64
  BUN_TARGET := bun-windows-x64
  BINARY := $(PLUGIN).exe
else ifeq ($(UNAME_S),Darwin)
  ifeq ($(UNAME_M),arm64)
    PLATFORM := macos-arm64
    BUN_TARGET := bun-darwin-arm64
  else
    PLATFORM := unsupported-macos
  endif
else ifeq ($(UNAME_S),Linux)
  PLATFORM := linux-x64
  BUN_TARGET := bun-linux-x64
endif
BINARY ?= $(PLUGIN)

.PHONY: build-ui build-sidecar check lint fmt test package verify-package smoke conformance planeai-cli clean

UI_ENTRIES := routines sidebar

build-ui:
	rm -rf build/ui
	for entry in $(UI_ENTRIES); do UI_ENTRY=$$entry pnpm exec vite build || exit 1; done

build-sidecar:
	@case "$(PLATFORM)" in unsupported*|"") echo "Unsupported packaging platform; Apple Silicon, linux-x64 and windows-x64 are supported" >&2; exit 2;; esac
	bun build --compile --minify --target=$(BUN_TARGET) src/main.ts --outfile build/bin/$(BINARY)

check:
	pnpm exec tsc
	pnpm exec svelte-check --fail-on-warnings

lint:
	pnpm lint
	pnpm fmt:check

fmt:
	pnpm fmt

test: check
	pnpm exec vitest run

package: build-ui build-sidecar
	rm -rf $(DIST)
	mkdir -p $(DIST)/bin/$(PLATFORM) $(DIST)/ui
	node scripts/stage-manifest.mjs $(PLATFORM) > $(DIST)/planeai-plugin.json
	cp build/ui/*.js $(DIST)/ui/
	cp build/bin/$(BINARY) $(DIST)/bin/$(PLATFORM)/$(BINARY)
	chmod +x $(DIST)/bin/$(PLATFORM)/$(BINARY)
	@echo "Staged $(DIST) for $(PLATFORM)"

verify-package: package
	node scripts/verify-package-handshake.mjs $(DIST) $(PLATFORM)

# Plays PlaneAI against the staged sidecar: a due routine must create exactly one task and ask for its session.
smoke: package
	node scripts/smoke.mjs $(DIST) $(PLATFORM)

# Full host contract checks, offline: PLANEAI_CLI points at a planeai-cli build of the host.
conformance: planeai-cli package
	$(PLANEAI_CLI) plugin test --package $(DIST)

planeai-cli:
	@if [ -z "$(PLANEAI_CLI)" ]; then echo "Set PLANEAI_CLI to a planeai-cli build of the host: make conformance PLANEAI_CLI=/path/to/planeai-cli" >&2; exit 2; fi

clean:
	rm -rf build dist
