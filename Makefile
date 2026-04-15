PREFIX ?= $(HOME)/.local
VERSION := $(shell grep '"version"' package.json | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
LIBDIR := $(PREFIX)/lib/knotes

.PHONY: all install uninstall clean test fmt check dev dev-web deps run web-build build release deploy

all: check test

# --- Dependencies ---

deps:
	npm install
	cd src/web/app && npm install

# --- Development ---

dev: deps check web-build
	npx tsx src/main.ts server

run:
	npx tsx src/main.ts $(ARGS)

dev-web:
	cd src/web/app && npx vite dev

web-build: deps
	cd src/web/app && npx vite build

build: web-build
	node scripts/build.js

# --- Quality ---

test:
	npx vitest run

fmt:
	npx prettier --write 'src/**/*.{ts,tsx,css,json}' 'test/**/*.ts'

check:
	npx tsc --noEmit
	cd src/web/app && npx tsc --noEmit

# --- Install ---

install: build
	install -d $(LIBDIR)
	cp -r dist node_modules package.json $(LIBDIR)/
	install -d $(PREFIX)/bin
	@printf '#!/bin/sh\nKNOTES_BIN="$(PREFIX)/bin/knotes"\nexport KNOTES_BIN\nexec node "$(LIBDIR)/dist/main.js" "$$@"\n' > $(PREFIX)/bin/knotes
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

# Tag and push — CI builds and publishes the release.
release:
	@echo "Tagging v$(VERSION)..."
	git tag "v$(VERSION)"
	git push origin "v$(VERSION)"
	@echo "Tag v$(VERSION) pushed. CI will build and publish the release."
