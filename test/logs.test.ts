import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let testHome: string;

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), "knotes-test-"));
  process.env["KNOTES_HOME"] = testHome;
  const { resetConfigCache } = await import("../src/core/config.ts");
  resetConfigCache();
  const { resetStore } = await import("../src/core/search.ts");
  resetStore();
  const { ensureHome } = await import("../src/core/config.ts");
  await ensureHome();
});

afterEach(async () => {
  await rm(testHome, { recursive: true, force: true });
  delete process.env["KNOTES_HOME"];
});

test("createLog creates a log file", async () => {
  const { createLog } = await import("../src/core/logs.ts");
  await createLog("logs/daily", "Daily Log");
  const raw = await readFile(join(testHome, "logs/daily.md"), "utf-8");
  expect(raw).toMatch(/title:\s*['"]?Daily Log['"]?/);
  expect(raw).toContain("type: log");
});

test("createLog rejects paths not under logs/", async () => {
  const { createLog } = await import("../src/core/logs.ts");
  expect(createLog("notes/oops")).rejects.toThrow("must be created under logs/");
  expect(createLog("test")).rejects.toThrow("must be created under logs/");
});

test("createLog rejects duplicate", async () => {
  const { createLog } = await import("../src/core/logs.ts");
  await createLog("logs/dup");
  expect(createLog("logs/dup")).rejects.toThrow("already exists");
});

test("addEntry adds an entry to a log", async () => {
  const { createLog, addEntry, listEntries } = await import("../src/core/logs.ts");
  await createLog("logs/test");
  const entry = await addEntry("logs/test", "First entry");
  expect(entry.id).toMatch(/^e-[a-f0-9]{16}$/);
  expect(entry.content).toBe("First entry");
  expect(entry.timestamp).toBeTruthy();

  const entries = await listEntries("logs/test");
  expect(entries.length).toBe(1);
  expect(entries[0]!.content).toBe("First entry");
});

test("addEntry fails if log does not exist", async () => {
  const { addEntry } = await import("../src/core/logs.ts");
  expect(addEntry("logs/nonexistent", "test")).rejects.toThrow("Log not found");
});

test("entries are ordered newest first", async () => {
  const { createLog, addEntry, listEntries } = await import("../src/core/logs.ts");
  await createLog("logs/order");
  await addEntry("logs/order", "First");
  await addEntry("logs/order", "Second");
  await addEntry("logs/order", "Third");

  const entries = await listEntries("logs/order");
  expect(entries.length).toBe(3);
  expect(entries[0]!.content).toBe("Third");
  expect(entries[1]!.content).toBe("Second");
  expect(entries[2]!.content).toBe("First");
});

test("listEntries respects limit", async () => {
  const { createLog, addEntry, listEntries } = await import("../src/core/logs.ts");
  await createLog("logs/limit");
  await addEntry("logs/limit", "One");
  await addEntry("logs/limit", "Two");
  await addEntry("logs/limit", "Three");

  const entries = await listEntries("logs/limit", { limit: 2 });
  expect(entries.length).toBe(2);
  expect(entries[0]!.content).toBe("Three");
  expect(entries[1]!.content).toBe("Two");
});

test("updateEntry preserves timestamp and order", async () => {
  const { createLog, addEntry, updateEntry, listEntries } = await import("../src/core/logs.ts");
  await createLog("logs/update");
  const e1 = await addEntry("logs/update", "First");
  await addEntry("logs/update", "Second");

  const updated = await updateEntry("logs/update", e1.id, "First (updated)");
  expect(updated.content).toBe("First (updated)");
  expect(updated.timestamp).toBe(e1.timestamp); // timestamp preserved

  const entries = await listEntries("logs/update");
  expect(entries.length).toBe(2);
  expect(entries[0]!.content).toBe("Second"); // order preserved
  expect(entries[1]!.content).toBe("First (updated)");
});

test("updateEntry throws for missing entry", async () => {
  const { createLog, updateEntry } = await import("../src/core/logs.ts");
  await createLog("logs/missing");
  expect(updateEntry("logs/missing", "e-0000", "new")).rejects.toThrow("Entry not found");
});

test("deleteEntry removes an entry", async () => {
  const { createLog, addEntry, deleteEntry, listEntries } = await import("../src/core/logs.ts");
  await createLog("logs/delete");
  const e1 = await addEntry("logs/delete", "Keep");
  const e2 = await addEntry("logs/delete", "Remove");

  await deleteEntry("logs/delete", e2.id);
  const entries = await listEntries("logs/delete");
  expect(entries.length).toBe(1);
  expect(entries[0]!.content).toBe("Keep");
});

test("deleteEntry throws for missing entry", async () => {
  const { createLog, deleteEntry } = await import("../src/core/logs.ts");
  await createLog("logs/del-missing");
  expect(deleteEntry("logs/del-missing", "e-0000")).rejects.toThrow("Entry not found");
});

test("getEntry returns a specific entry", async () => {
  const { createLog, addEntry, getEntry } = await import("../src/core/logs.ts");
  await createLog("logs/get");
  const e = await addEntry("logs/get", "Specific entry");
  const found = await getEntry("logs/get", e.id);
  expect(found).not.toBeNull();
  expect(found!.content).toBe("Specific entry");
});

test("getEntry returns null for missing entry", async () => {
  const { createLog, getEntry } = await import("../src/core/logs.ts");
  await createLog("logs/get-missing");
  const found = await getEntry("logs/get-missing", "e-0000");
  expect(found).toBeNull();
});

test("listEntries filters by since", async () => {
  const { createLog, listEntries } = await import("../src/core/logs.ts");
  await createLog("logs/since-test");
  await writeFile(join(testHome, "logs/since-test.md"), [
    "---",
    'title: since-test',
    "type: log",
    "---",
    "",
    "## 2025-04-06T00:00:00.000Z {#e-aa00000000000001}",
    "",
    "Old entry",
    "",
    "## 2025-04-08T12:00:00.000Z {#e-aa00000000000002}",
    "",
    "Mid entry",
    "",
    "## 2025-04-10T00:00:00.000Z {#e-aa00000000000003}",
    "",
    "New entry",
  ].join("\n"));

  const entries = await listEntries("logs/since-test", { since: "2025-04-07T00:00:00.000Z" });
  expect(entries.length).toBe(2);
  const contents = entries.map((e) => e.content);
  expect(contents).toContain("Mid entry");
  expect(contents).toContain("New entry");
  expect(contents).not.toContain("Old entry");
});

test("listEntries filters by before", async () => {
  const { createLog, listEntries } = await import("../src/core/logs.ts");
  await createLog("logs/before-test");
  await writeFile(join(testHome, "logs/before-test.md"), [
    "---",
    'title: before-test',
    "type: log",
    "---",
    "",
    "## 2025-04-06T00:00:00.000Z {#e-bb00000000000001}",
    "",
    "Old entry",
    "",
    "## 2025-04-08T12:00:00.000Z {#e-bb00000000000002}",
    "",
    "Mid entry",
    "",
    "## 2025-04-10T00:00:00.000Z {#e-bb00000000000003}",
    "",
    "New entry",
  ].join("\n"));

  const entries = await listEntries("logs/before-test", { before: "2025-04-09T00:00:00.000Z" });
  expect(entries.length).toBe(2);
  const contents = entries.map((e) => e.content);
  expect(contents).toContain("Old entry");
  expect(contents).toContain("Mid entry");
  expect(contents).not.toContain("New entry");
});

test("listEntries filters by since and before range", async () => {
  const { createLog, listEntries } = await import("../src/core/logs.ts");
  await createLog("logs/range-test");
  await writeFile(join(testHome, "logs/range-test.md"), [
    "---",
    'title: range-test',
    "type: log",
    "---",
    "",
    "## 2025-04-06T00:00:00.000Z {#e-cc00000000000001}",
    "",
    "Old entry",
    "",
    "## 2025-04-08T12:00:00.000Z {#e-cc00000000000002}",
    "",
    "Mid entry",
    "",
    "## 2025-04-10T00:00:00.000Z {#e-cc00000000000003}",
    "",
    "New entry",
  ].join("\n"));

  const entries = await listEntries("logs/range-test", {
    since: "2025-04-07T00:00:00.000Z",
    before: "2025-04-09T00:00:00.000Z",
  });
  expect(entries.length).toBe(1);
  expect(entries[0]!.content).toBe("Mid entry");
});

test("listEntries date filter combined with limit", async () => {
  const { createLog, listEntries } = await import("../src/core/logs.ts");
  await createLog("logs/filter-limit");
  await writeFile(join(testHome, "logs/filter-limit.md"), [
    "---",
    'title: filter-limit',
    "type: log",
    "---",
    "",
    "## 2025-04-08T00:00:00.000Z {#e-dd00000000000001}",
    "",
    "Entry A",
    "",
    "## 2025-04-09T00:00:00.000Z {#e-dd00000000000002}",
    "",
    "Entry B",
    "",
    "## 2025-04-10T00:00:00.000Z {#e-dd00000000000003}",
    "",
    "Entry C",
  ].join("\n"));

  // since filters to A/B/C, then limit cuts to first 2
  const entries = await listEntries("logs/filter-limit", {
    since: "2025-04-07T00:00:00.000Z",
    limit: 2,
  });
  expect(entries.length).toBe(2);
});

test("rotation: addEntry rotates log.md into log.1.md when size limit is reached", async () => {
  const { saveConfig } = await import("../src/core/config.ts");
  await saveConfig({ logSegmentMaxBytes: 1 }); // tiny limit so any write triggers rotation

  const { createLog, addEntry, listEntries } = await import("../src/core/logs.ts");
  await createLog("logs/rot", "Rotation Test");
  await addEntry("logs/rot", "Entry A");
  // log.md now exceeds 1 byte — next write should rotate
  await addEntry("logs/rot", "Entry B");

  const seg1 = await readFile(join(testHome, "logs/rot.1.md"), "utf-8");
  expect(seg1).toContain("Entry A");

  const main = await readFile(join(testHome, "logs/rot.md"), "utf-8");
  expect(main).toContain("Entry B");
  expect(main).not.toContain("Entry A");

  // listEntries merges both segments
  const all = await listEntries("logs/rot");
  expect(all).toHaveLength(2);
  expect(all[0]!.content).toBe("Entry B"); // newest first
  expect(all[1]!.content).toBe("Entry A");
});

test("rotation: cascade rotates existing segments up", async () => {
  const { saveConfig } = await import("../src/core/config.ts");
  await saveConfig({ logSegmentMaxBytes: 1 });

  const { createLog, addEntry, listEntries } = await import("../src/core/logs.ts");
  await createLog("logs/cascade", "Cascade Test");
  await addEntry("logs/cascade", "Entry A");
  await addEntry("logs/cascade", "Entry B"); // A → log.1.md
  await addEntry("logs/cascade", "Entry C"); // B → log.1.md, A → log.2.md

  expect(existsSync(join(testHome, "logs/cascade.1.md"))).toBe(true);
  expect(existsSync(join(testHome, "logs/cascade.2.md"))).toBe(true);

  const all = await listEntries("logs/cascade");
  expect(all).toHaveLength(3);
  expect(all.map((e) => e.content)).toEqual(["Entry C", "Entry B", "Entry A"]);
});

test("rotation: updateEntry and deleteEntry find entries in older segments", async () => {
  const { saveConfig } = await import("../src/core/config.ts");
  await saveConfig({ logSegmentMaxBytes: 1 });

  const { createLog, addEntry, updateEntry, deleteEntry, listEntries } = await import("../src/core/logs.ts");
  await createLog("logs/seg-ops", "Segment ops");
  const e1 = await addEntry("logs/seg-ops", "Old entry");
  await addEntry("logs/seg-ops", "New entry"); // e1 moves to log.1.md

  // Update entry that is now in a segment
  await updateEntry("logs/seg-ops", e1.id, "Old entry (updated)");
  const afterUpdate = await listEntries("logs/seg-ops");
  expect(afterUpdate.find((e) => e.id === e1.id)!.content).toBe("Old entry (updated)");

  // Delete entry from a segment
  await deleteEntry("logs/seg-ops", e1.id);
  const afterDelete = await listEntries("logs/seg-ops");
  expect(afterDelete).toHaveLength(1);
  expect(afterDelete[0]!.content).toBe("New entry");
});

test("rotation: listEntries with limit and before span across segments", async () => {
  const { saveConfig } = await import("../src/core/config.ts");
  await saveConfig({ logSegmentMaxBytes: 1 });

  const { createLog, listEntries } = await import("../src/core/logs.ts");
  await createLog("logs/paginate", "Paginate");
  // Write entries directly to simulate a rotated log
  await writeFile(join(testHome, "logs/paginate.1.md"), [
    "## 2025-04-06T00:00:00.000Z {#e-aa00000000000001}",
    "",
    "Old entry",
  ].join("\n") + "\n");
  await writeFile(join(testHome, "logs/paginate.md"), [
    "---",
    "title: Paginate",
    "type: log",
    "---",
    "",
    "## 2025-04-10T00:00:00.000Z {#e-aa00000000000002}",
    "",
    "New entry",
  ].join("\n") + "\n");

  // Load page 1 (limit=1, no before) → newest entry
  const page1 = await listEntries("logs/paginate", { limit: 1 });
  expect(page1).toHaveLength(1);
  expect(page1[0]!.content).toBe("New entry");

  // Load page 2 (before=page1 oldest timestamp) → entry from segment
  const page2 = await listEntries("logs/paginate", { limit: 1, before: page1[0]!.timestamp });
  expect(page2).toHaveLength(1);
  expect(page2[0]!.content).toBe("Old entry");
});

test("listJournals does not expose segment files", async () => {
  const { createLog, addEntry, listJournals } = await import("../src/core/logs.ts");
  const { saveConfig } = await import("../src/core/config.ts");
  await saveConfig({ logSegmentMaxBytes: 1 });

  await createLog("logs/visible", "Visible");
  await addEntry("logs/visible", "A");
  await addEntry("logs/visible", "B"); // triggers rotation, creates logs/visible.1.md

  const journals = await listJournals();
  const paths = journals.map((j) => j.path);
  expect(paths).toContain("logs/visible");
  expect(paths.every((p) => !p.endsWith(".1"))).toBe(true);
});

test("log file format is valid markdown", async () => {
  const { createLog, addEntry } = await import("../src/core/logs.ts");
  await createLog("logs/format", "Format Test");
  await addEntry("logs/format", "Entry one");
  await addEntry("logs/format", "Entry two");

  const raw = await readFile(join(testHome, "logs/format.md"), "utf-8");
  // Should have frontmatter
  expect(raw).toMatch(/^---\n/);
  // Should have H2 headings with timestamps and IDs
  expect(raw).toMatch(/## \d{4}-\d{2}-\d{2}T.+? \{#e-[a-f0-9]{16}\}/);
  // Newest first
  const lines = raw.split("\n");
  const headings = lines.filter((l) => l.startsWith("## "));
  expect(headings.length).toBe(2);
});
