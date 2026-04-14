#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const tsx = join(root, "node_modules", ".bin", "tsx");
const main = join(root, "src", "main.ts");

const result = spawnSync(tsx, [main, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
