PREFIX ?= $(HOME)/.local

.PHONY: all build install uninstall clean test fmt check dev dev-web deps run web-build

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

install: build
	install -d $(PREFIX)/bin
	install -m 755 dist/knotes $(PREFIX)/bin/knotes

uninstall:
	rm -f $(PREFIX)/bin/knotes

clean:
	rm -rf dist src/web/app/dist
