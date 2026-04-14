#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const main = join(root, "src", "main.ts");

// Find tsx: check package's own node_modules first, then walk up (for hoisted installs like bun)
function findTsx() {
  let dir = root;
  while (true) {
    const candidate = join(dir, "node_modules", ".bin", "tsx");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume tsx is in PATH
  return "tsx";
}

const tsx = findTsx();
const result = spawnSync(tsx, [main, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
