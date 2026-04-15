#!/usr/bin/env node
// Build script: compiles src/main.ts → dist/main.js and copies frontend assets.
// All npm dependencies remain external (stays in node_modules at runtime).
// Only tsx is eliminated — plain `node dist/main.js` runs the app.

import { build } from "esbuild";
import { readFileSync, mkdirSync, cpSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// All npm dependencies stay external — they live in node_modules at runtime.
const external = Object.keys({
  ...pkg.dependencies,
  ...pkg.peerDependencies,
});

await build({
  entryPoints: [join(root, "src/main.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: join(root, "dist/main.js"),
  external,
  // Inject the version at build time so version.ts works without package.json at runtime.
  define: {
    __PACKAGE_VERSION__: JSON.stringify(pkg.version),
  },
});

// Copy built frontend assets so server.ts can find them at dist/app/dist/
// (server.ts resolves: join(__dirname, "app", "dist") where __dirname = dist/ in the bundle)
const webDistSrc = join(root, "src/web/app/dist");
if (!existsSync(webDistSrc)) {
  console.error("Error: src/web/app/dist not found. Run the frontend build first.");
  process.exit(1);
}
const webDistDest = join(root, "dist/app/dist");
mkdirSync(webDistDest, { recursive: true });
cpSync(webDistSrc, webDistDest, { recursive: true });

console.log(`Built dist/main.js (v${pkg.version})`);
