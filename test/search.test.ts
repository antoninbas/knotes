import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, unlink, mkdir, writeFile } from "fs/promises";
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

test("search results for files with spaces/punctuation can be opened", async () => {
  const { getNote } = await import("../src/core/notes.ts");
  const { search, updateIndex } = await import("../src/core/search.ts");

  // Write the files directly, bypassing createNote's path normalization,
  // so we exercise the handelize-aware path resolver on reads.
  await mkdir(join(testHome, "notes", "odd"), { recursive: true });
  const frontmatter = (title: string, body: string) =>
    `---\ntitle: "${title}"\ncreated: 2026-01-01T00:00:00.000Z\nmodified: 2026-01-01T00:00:00.000Z\ntags: []\ntype: note\n---\n\n${body}\n`;
  await writeFile(
    join(testHome, "notes", "odd", "Mixed Case With Spaces.md"),
    frontmatter("Mixed Case With Spaces", "Beekeeping notes and queen marking tips."),
  );
  await writeFile(
    join(testHome, "notes", "odd", "parens (and) punctuation!.md"),
    frontmatter("Parens And Punctuation", "Carbide tooling cribsheet."),
  );

  await updateIndex();

  // Both the qmd search result and direct getNote should resolve to the
  // on-disk files even though the logical path has been handelized.
  const results = await search("beekeeping queen marking", { mode: "bm25", limit: 5 });
  const spacey = results.find((r) => r.path.endsWith("/mixed-case-with-spaces"));
  expect(spacey).toBeTruthy();
  const fetched = await getNote(spacey!.path);
  expect(fetched.title).toBe("Mixed Case With Spaces");

  // Direct lookup by handelized path should also succeed.
  const punct = await getNote("notes/odd/parens-and-punctuation");
  expect(punct.title).toBe("Parens And Punctuation");
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
