PREFIX ?= $(HOME)/.local
VERSION := $(shell grep '"version"' package.json | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')

.PHONY: all build build-all install uninstall clean test fmt check dev dev-web deps run web-build release

all: check test build

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

# --- Build & Install ---

build:
	bun run build.ts

build-all:
	bun run build.ts --all

install: build
	install -d $(PREFIX)/bin
	install -m 755 dist/knotes $(PREFIX)/bin/knotes

uninstall:
	rm -f $(PREFIX)/bin/knotes

clean:
	rm -rf dist src/web/app/dist

# --- Release ---

release: clean build-all
	@echo "Creating release v$(VERSION)..."
	@cd dist && for f in knotes-*; do \
		tar czf "$${f}.tar.gz" "$$f" && echo "  Packaged $$f.tar.gz"; \
	done
	gh release create "v$(VERSION)" dist/knotes-*.tar.gz \
		--title "v$(VERSION)" \
		--generate-notes
	@echo "Released v$(VERSION)"
