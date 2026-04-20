import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "fs/promises";
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

test("createNote creates a markdown file with frontmatter", async () => {
  const { createNote } = await import("../src/core/notes.ts");
  const result = await createNote("notes/test", { title: "Test Note", tags: ["tag1"] });

  expect(result.path).toBe("notes/test");
  expect(result.title).toBe("Test Note");
  expect(result.tags).toEqual(["tag1"]);
  expect(result.type).toBe("note");

  const raw = await readFile(join(testHome, "notes/test.md"), "utf-8");
  expect(raw).toMatch(/title:\s*['"]?Test Note['"]?/);
  expect(raw).toContain("type: note");
});

test("createNote survives tricky title characters", async () => {
  const { createNote, getNote } = await import("../src/core/notes.ts");
  const tricky = `Weird: "quoted", new\nline & colon`;
  await createNote("notes/tricky", { title: tricky, content: "body" });
  const note = await getNote("notes/tricky");
  expect(note.title).toBe(tricky);
  expect(note.content).toBe("body");
});

test("updateNote preserves description and extra frontmatter fields", async () => {
  const { writeMarkdownFile, updateNote, getNote } = await import("../src/core/notes.ts");
  await writeMarkdownFile("notes/keep-extras", {
    title: "Has Extras",
    content: "Initial body",
    description: "This description must survive updates",
  });

  // Manually inject an extra field to mimic user-added frontmatter
  const { readFile, writeFile } = await import("fs/promises");
  const raw = await readFile(join(testHome, "notes/keep-extras.md"), "utf-8");
  await writeFile(
    join(testHome, "notes/keep-extras.md"),
    raw.replace("---\n\n", "status: draft\n---\n\n")
  );

  await updateNote("notes/keep-extras", { content: "Updated body" });
  const raw2 = await readFile(join(testHome, "notes/keep-extras.md"), "utf-8");

  expect(raw2).toContain("description:");
  expect(raw2).toContain("This description must survive updates");
  expect(raw2).toContain("status: draft");

  const note = await getNote("notes/keep-extras");
  expect(note.description).toBe("This description must survive updates");
  expect(note.content).toBe("Updated body");
});

test("createNote rejects paths not under notes/", async () => {
  const { createNote } = await import("../src/core/notes.ts");
  expect(createNote("test")).rejects.toThrow("Notes must be created under notes/");
  expect(createNote("logs/oops")).rejects.toThrow("Notes must be created under notes/");
});

test("createNote rejects duplicate", async () => {
  const { createNote } = await import("../src/core/notes.ts");
  await createNote("notes/dup");
  expect(createNote("notes/dup")).rejects.toThrow("already exists");
});

test("getNote reads a note", async () => {
  const { createNote, getNote } = await import("../src/core/notes.ts");
  await createNote("notes/read-me", { title: "Read Me", content: "Hello world" });
  const note = await getNote("notes/read-me");
  expect(note.title).toBe("Read Me");
  expect(note.content).toBe("Hello world");
});

test("getNote throws for missing note", async () => {
  const { getNote } = await import("../src/core/notes.ts");
  expect(getNote("notes/nonexistent")).rejects.toThrow("not found");
});

test("updateNote updates content and title", async () => {
  const { createNote, updateNote, getNote } = await import("../src/core/notes.ts");
  await createNote("notes/update-me", { title: "Old Title", content: "Old content" });
  const updated = await updateNote("notes/update-me", { title: "New Title", content: "New content" });
  expect(updated.title).toBe("New Title");
  expect(updated.content).toBe("New content");

  const reread = await getNote("notes/update-me");
  expect(reread.title).toBe("New Title");
  expect(reread.content).toBe("New content");
});

test("deleteNote removes the file", async () => {
  const { createNote, deleteNote, getNote } = await import("../src/core/notes.ts");
  await createNote("notes/delete-me");
  await deleteNote("notes/delete-me");
  expect(getNote("notes/delete-me")).rejects.toThrow("not found");
});

test("deleteNote throws for missing note", async () => {
  const { deleteNote } = await import("../src/core/notes.ts");
  expect(deleteNote("notes/nope")).rejects.toThrow("not found");
});

test("listNotes lists files and directories", async () => {
  const { createNote, createFolder, listNotes } = await import("../src/core/notes.ts");
  await createNote("notes/a", { title: "Note A" });
  await createNote("notes/b", { title: "Note B" });
  await createFolder("notes/sub");

  const entries = await listNotes("notes");
  expect(entries.length).toBe(3);
  expect(entries[0]!.type).toBe("directory"); // directories first
  expect(entries[0]!.path).toBe("notes/sub");
  expect(entries[1]!.title).toBe("Note A");
  expect(entries[2]!.title).toBe("Note B");
});

test("createFolder creates dir with .keep", async () => {
  const { createFolder } = await import("../src/core/notes.ts");
  await createFolder("notes/projects");
  expect(existsSync(join(testHome, "notes/projects/.keep"))).toBe(true);
});

test("createFolder rejects paths not under notes/ or logs/", async () => {
  const { createFolder } = await import("../src/core/notes.ts");
  expect(createFolder("random")).rejects.toThrow("must be created under notes/ or logs/");
});

test("createFolder rejects duplicate", async () => {
  const { createFolder } = await import("../src/core/notes.ts");
  await createFolder("notes/dup-dir");
  expect(createFolder("notes/dup-dir")).rejects.toThrow("already exists");
});

test("createNote auto-creates parent directories", async () => {
  const { createNote, getNote } = await import("../src/core/notes.ts");
  await createNote("notes/deep/nested/note", { title: "Deep" });
  const note = await getNote("notes/deep/nested/note");
  expect(note.title).toBe("Deep");
});
