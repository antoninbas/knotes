#!/usr/bin/env bun

import { $ } from "bun";
import { join } from "path";

const ROOT = import.meta.dir;

console.log("Building Knotes...\n");

// Step 1: Build frontend
console.log("1. Building frontend...");
await $`cd ${join(ROOT, "src/web/app")} && bun run build`;
console.log("   Frontend built.\n");

// Step 2: Compile the main binary
console.log("2. Compiling binary...");
await Bun.build({
  entrypoints: [join(ROOT, "src/main.ts")],
  outdir: join(ROOT, "dist"),
  target: "bun",
  minify: true,
});
console.log("   Binary compiled to dist/\n");

console.log("Done! Run with: bun run dist/main.js");
console.log("Or for a standalone binary: bun build --compile src/main.ts --outfile dist/knotes");
