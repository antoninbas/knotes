PREFIX ?= $(HOME)/.local
VERSION := $(shell grep '"version"' package.json | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
LIBDIR := $(PREFIX)/lib/knotes

.PHONY: all install uninstall clean test fmt check dev dev-web deps run web-build release deploy

all: check test

# --- Dependencies ---

deps:
	bun install
	cd src/web/app && bun install

# --- Development ---

dev: deps check web-build
	bun run src/main.ts server

run:
	bun run src/main.ts $(ARGS)

dev-web:
	cd src/web/app && bun run dev

web-build: deps
	cd src/web/app && bun run build

# --- Quality ---

test:
	bun test

fmt:
	bunx prettier --write 'src/**/*.{ts,tsx,css,json}' 'test/**/*.ts'

check:
	bun run tsc --noEmit
	cd src/web/app && bunx tsc --noEmit

# --- Install ---

install: deps web-build
	install -d $(LIBDIR)
	cp -r src package.json bun.lock node_modules $(LIBDIR)/
	cp -r src/web/app/node_modules $(LIBDIR)/src/web/app/ 2>/dev/null || true
	git describe --tags --always > $(LIBDIR)/VERSION
	install -d $(PREFIX)/bin
	@printf '#!/bin/sh\nexec "$(shell which bun)" run "$(LIBDIR)/src/main.ts" "$$@"\n' > $(PREFIX)/bin/knotes
	chmod +x $(PREFIX)/bin/knotes
	@echo "Installed knotes v$(VERSION) to $(PREFIX)/bin/knotes"

uninstall:
	rm -f $(PREFIX)/bin/knotes
	rm -rf $(LIBDIR)

clean:
	rm -rf dist src/web/app/dist

# --- Deploy (local machine) ---

deploy:
	./scripts/deploy-local.sh

# --- Release ---

# Tag and push — CI (release.yml) builds platform tarballs and creates the GitHub release.
release:
	@echo "Tagging v$(VERSION)..."
	git tag "v$(VERSION)"
	git push origin "v$(VERSION)"
	@echo "Tag v$(VERSION) pushed. CI will build and publish the release."
