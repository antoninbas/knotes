import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Harness } from "./harness.ts";

const SETUP_TIMEOUT = 360_000;
const TEST_TIMEOUT = 30_000;

for (const mode of ["serverless", "server"] as const) {
  describe(`crud e2e [${mode}]`, () => {
    const h = new Harness();

    beforeAll(async () => {
      await h.start(mode);
    }, SETUP_TIMEOUT);

    afterAll(async () => {
      await h.stop();
    });

    // --- Note CRUD ---

    test("note: create → get → update → delete", async () => {
      const path = "notes/_e2e/crud-test-note";

      // Create
      const created = await h.createNote(path, {
        title: "E2E Test Note",
        content: "Initial content for the e2e crud test.",
        tags: ["e2e"],
      });
      expect(created.path).toBe(path);
      expect(created.title).toBe("E2E Test Note");
      expect(created.content).toContain("Initial content");

      // Get
      const fetched = await h.getNote(path);
      expect(fetched.path).toBe(path);
      expect(fetched.title).toBe("E2E Test Note");

      // Update
      const updated = await h.updateNote(path, {
        title: "Updated E2E Note",
        content: "Updated content for the test.",
      });
      expect(updated.title).toBe("Updated E2E Note");
      expect(updated.content).toContain("Updated content");

      // Verify update persisted
      const afterUpdate = await h.getNote(path);
      expect(afterUpdate.title).toBe("Updated E2E Note");

      // Delete
      await h.deleteNote(path);

      // Verify deleted
      await expect(h.getNote(path)).rejects.toThrow();
    }, TEST_TIMEOUT);

    test("note: created note appears in listNotes", async () => {
      const path = "notes/_e2e/list-test-note";
      await h.createNote(path, { title: "List Test Note" });

      const entries = await h.listNotes("notes/_e2e");
      const paths = entries.map((e) => e.path);
      expect(paths).toContain(path);

      await h.deleteNote(path);
    }, TEST_TIMEOUT);

    // --- Folder CRUD ---

    test("folder: create → list → delete", async () => {
      const folderPath = "notes/_e2e/test-folder";
      await h.createFolder(folderPath);

      const entries = await h.listNotes("notes/_e2e");
      const paths = entries.map((e) => e.path);
      expect(paths).toContain(folderPath);

      await h.deleteFolder(folderPath);
    }, TEST_TIMEOUT);

    // --- Log / entry CRUD ---

    test("log: create → addEntry → listEntries → updateEntry → deleteEntry → deleteLog", async () => {
      const logPath = "logs/_e2e/crud-test-journal";

      // Create log
      await h.createLog(logPath, "E2E Test Journal");

      // Add first entry
      const entry1 = await h.addEntry(logPath, "First entry content.");
      expect(entry1.id).toMatch(/^e-[0-9a-f]+$/);
      expect(entry1.content).toBe("First entry content.");

      // Add second entry
      const entry2 = await h.addEntry(logPath, "Second entry content.");
      expect(entry2.id).not.toBe(entry1.id);

      // List entries
      const entries = await h.listEntries(logPath);
      expect(entries.length).toBeGreaterThanOrEqual(2);
      // Newest first
      expect(entries[0].id).toBe(entry2.id);
      expect(entries[1].id).toBe(entry1.id);

      // Update entry
      const updated = await h.updateEntry(logPath, entry1.id, "Updated first entry content.");
      expect(updated.content).toBe("Updated first entry content.");

      // Delete entry
      await h.deleteEntry(logPath, entry1.id);
      const afterDelete = await h.listEntries(logPath);
      const ids = afterDelete.map((e) => e.id);
      expect(ids).not.toContain(entry1.id);
      expect(ids).toContain(entry2.id);

      // Delete log
      await h.deleteLog(logPath);
      await expect(h.listEntries(logPath)).rejects.toThrow();
    }, TEST_TIMEOUT);

    test("log: appears in listJournals after creation", async () => {
      const logPath = "logs/_e2e/list-test-journal";
      await h.createLog(logPath, "List Test Journal");

      const journals = await h.listJournals("logs/_e2e");
      const paths = journals.map((j) => j.path);
      expect(paths).toContain(logPath);

      await h.deleteLog(logPath);
    }, TEST_TIMEOUT);

    // --- Context CRUD ---

    test("context: set → get → list → remove", async () => {
      const ctxPath = "notes/_e2e/ctx-test";
      const contextText = "This is a test context for e2e testing.";

      await h.setContext(ctxPath, contextText);

      const fetched = await h.getContext(ctxPath);
      expect(fetched).toBe(contextText);

      const all = await h.listContexts();
      const paths = all.map((c) => c.path);
      expect(paths).toContain(ctxPath);

      await h.removeContext(ctxPath);

      const afterRemove = await h.getContext(ctxPath);
      expect(afterRemove).toBeUndefined();
    }, TEST_TIMEOUT);
  });
}
