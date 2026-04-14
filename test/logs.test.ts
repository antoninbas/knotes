import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "fs/promises";
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
  expect(raw).toContain('title: "Daily Log"');
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
  expect(entry.id).toMatch(/^e-[a-f0-9]{4}$/);
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

test("log file format is valid markdown", async () => {
  const { createLog, addEntry } = await import("../src/core/logs.ts");
  await createLog("logs/format", "Format Test");
  await addEntry("logs/format", "Entry one");
  await addEntry("logs/format", "Entry two");

  const raw = await readFile(join(testHome, "logs/format.md"), "utf-8");
  // Should have frontmatter
  expect(raw).toMatch(/^---\n/);
  // Should have H2 headings with timestamps and IDs
  expect(raw).toMatch(/## \d{4}-\d{2}-\d{2}T.+? \{#e-[a-f0-9]{4}\}/);
  // Newest first
  const lines = raw.split("\n");
  const headings = lines.filter((l) => l.startsWith("## "));
  expect(headings.length).toBe(2);
});
