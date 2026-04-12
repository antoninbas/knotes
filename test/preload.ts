/**
 * Preload qmd models before tests run.
 * This avoids model download timeouts inside individual tests.
 * Configured as a bun test preload in package.json.
 */
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const tmpHome = await mkdtemp(join(tmpdir(), "knotes-preload-"));
process.env["KNOTES_HOME"] = tmpHome;

const { resetConfigCache, ensureHome } = await import("../src/core/config.ts");
resetConfigCache();
await ensureHome();

// Initialize qmd store — triggers model download if needed
const { createStore } = await import("@tobilu/qmd");
const store = await createStore({
  dbPath: join(tmpHome, ".data/index.sqlite"),
  config: {
    collections: {
      notes: { path: join(tmpHome, "notes"), pattern: "**/*.md" },
    },
  },
});

// Clean up
delete process.env["KNOTES_HOME"];
resetConfigCache();
await rm(tmpHome, { recursive: true, force: true });
