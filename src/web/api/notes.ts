import { Hono } from "hono";
import { ensureHome, resolvePath } from "../../core/config.ts";
import {
  createNote,
  createFolder,
  getNote,
  updateNote,
  deleteNote,
  listNotes,
} from "../../core/notes.ts";
import { importDocument, checkMarkitdown } from "../../core/importer.ts";
import { basename } from "path";

export const notesApi = new Hono();

// List notes at a prefix
notesApi.get("/", async (c) => {
  await ensureHome();
  const prefix = c.req.query("prefix") || undefined;
  const entries = await listNotes(prefix);
  return c.json(entries);
});

// Get a note by path (path passed as query param since it contains slashes)
notesApi.get("/get", async (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path is required" }, 400);
  try {
    const note = await getNote(path);
    return c.json(note);
  } catch (err: any) {
    return c.json({ error: err.message }, 404);
  }
});

// Download the raw markdown file
notesApi.get("/download", async (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path is required" }, 400);
  try {
    const filePath = resolvePath(path);
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return c.json({ error: "not found" }, 404);
    }
    const raw = await file.text();
    const filename = basename(filePath);
    return new Response(raw, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 404);
  }
});

// Create a note
notesApi.post("/", async (c) => {
  await ensureHome();
  const body = await c.req.json();
  const { path, title, content, tags } = body;
  if (!path) return c.json({ error: "path is required" }, 400);
  try {
    const note = await createNote(path, { title, content, tags });
    return c.json(note, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// Update a note
notesApi.put("/", async (c) => {
  const body = await c.req.json();
  const { path, title, content, tags } = body;
  if (!path) return c.json({ error: "path is required" }, 400);
  try {
    const note = await updateNote(path, { title, content, tags });
    return c.json(note);
  } catch (err: any) {
    return c.json({ error: err.message }, 404);
  }
});

// Create a folder
notesApi.post("/folder", async (c) => {
  await ensureHome();
  const body = await c.req.json();
  const { path } = body;
  if (!path) return c.json({ error: "path is required" }, 400);
  try {
    await createFolder(path);
    return c.json({ ok: true, path }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// Import a document
notesApi.post("/import", async (c) => {
  const body = await c.req.json();
  const { filePath, to } = body;
  if (!filePath) return c.json({ error: "filePath is required" }, 400);
  try {
    const available = await checkMarkitdown();
    if (!available) {
      return c.json({ error: "markitdown is not installed. Install with: pip install 'markitdown[all]'" }, 400);
    }
    const result = await importDocument(filePath, { to });
    return c.json(result, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// Delete a note
notesApi.delete("/", async (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path is required" }, 400);
  try {
    await deleteNote(path);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 404);
  }
});
