PREFIX ?= $(HOME)/.local

.PHONY: build install uninstall clean

build:
	bun run build.ts

install: build
	install -d $(PREFIX)/bin
	install -m 755 dist/knotes $(PREFIX)/bin/knotes

uninstall:
	rm -f $(PREFIX)/bin/knotes

clean:
	rm -rf dist
