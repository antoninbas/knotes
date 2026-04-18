import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let testHome: string;

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "knotes-search-test-"));
  process.env["KNOTES_HOME"] = testHome;
  const { resetConfigCache, ensureHome } = await import("../src/core/config.ts");
  resetConfigCache();
  const { resetDb } = await import("../src/core/db.ts");
  resetDb();
  const { resetStore } = await import("../src/core/search.ts");
  resetStore();
  await ensureHome();
});

afterEach(async () => {
  const { resetDb } = await import("../src/core/db.ts");
  resetDb();
  await rm(testHome, { recursive: true, force: true });
  delete process.env["KNOTES_HOME"];
});

test("search results carry the frontmatter title, not the filename", async () => {
  const { createNote } = await import("../src/core/notes.ts");
  const { search, updateIndex } = await import("../src/core/search.ts");

  await createNote("notes/zipline-rigging", {
    title: "Zipline Rigging Checklist",
    content: "Pre-flight inspection steps for every zipline installation.",
  });
  await updateIndex();

  const results = await search("zipline rigging", { mode: "bm25", limit: 5 });
  const hit = results.find((r) => r.path === "notes/zipline-rigging");
  expect(hit).toBeTruthy();
  expect(hit?.title).toBe("Zipline Rigging Checklist");
}, 60_000);

test("search results for logs carry the log's title, not an entry timestamp", async () => {
  const { createLog, addEntry } = await import("../src/core/logs.ts");
  const { search, updateIndex } = await import("../src/core/search.ts");

  await createLog("logs/sourdough", "Sourdough Journal", "Ongoing bread experiments");
  await addEntry("logs/sourdough", "Tried 85% hydration. Crumb was beautifully open.");
  await updateIndex();

  const results = await search("hydration", { mode: "bm25", limit: 5 });
  const hit = results.find((r) => r.path === "logs/sourdough");
  expect(hit).toBeTruthy();
  expect(hit?.title).toBe("Sourdough Journal");
  // Make sure we're not leaking the per-entry "## <timestamp> {#e-...}" heading.
  expect(hit?.title).not.toMatch(/\{#e-/);
}, 60_000);

test("search reindexes after an out-of-band file deletion", async () => {
  const { createNote } = await import("../src/core/notes.ts");
  const { search, updateIndex } = await import("../src/core/search.ts");

  await createNote("notes/ephemeral", {
    title: "Ephemeral Note",
    content: "A quite unusual pangram aphorism about xylophone ziggurats.",
  });
  await updateIndex();

  let results = await search("xylophone ziggurats", { mode: "bm25", limit: 5 });
  expect(results.some((r) => r.path === "notes/ephemeral")).toBe(true);

  // Delete the file out-of-band (simulates a git pull or manual rm).
  await unlink(join(testHome, "notes/ephemeral.md"));

  // Small delay to ensure the directory mtime advances past the previous
  // indexing timestamp (most filesystems have at least ms-level mtime).
  await new Promise((r) => setTimeout(r, 20));

  results = await search("xylophone ziggurats", { mode: "bm25", limit: 5 });
  expect(results.some((r) => r.path === "notes/ephemeral")).toBe(false);
}, 60_000);
