import { Hono } from "hono";
import { z } from "zod";
import { ensureHome, resolvePath } from "../../core/config.ts";
import {
  createNote,
  createFolder,
  deleteFolder,
  getNote,
  updateNote,
  deleteNote,
  listNotes,
} from "../../core/notes.ts";
import { importDocument, checkMarkitdown } from "../../core/importer.ts";
import { basename } from "path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const CreateNoteSchema = z.object({
  path: z.string().min(1, "path is required"),
  title: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const UpdateNoteSchema = z.object({
  path: z.string().min(1, "path is required"),
  title: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const CreateFolderSchema = z.object({
  path: z.string().min(1, "path is required"),
});

const ImportDocumentSchema = z.object({
  filePath: z.string().min(1, "filePath is required"),
  to: z.string().optional(),
});

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
    if (!existsSync(filePath)) {
      return c.json({ error: "not found" }, 404);
    }
    const raw = await readFile(filePath, "utf-8");
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
  const raw = await c.req.json().catch(() => null);
  const parsed = CreateNoteSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, 400);
  }
  const { path, title, content, tags } = parsed.data;
  try {
    const note = await createNote(path, { title, content, tags });
    return c.json(note, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// Update a note
notesApi.put("/", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = UpdateNoteSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, 400);
  }
  const { path, title, content, tags } = parsed.data;
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
  const raw = await c.req.json().catch(() => null);
  const parsed = CreateFolderSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, 400);
  }
  const { path } = parsed.data;
  try {
    await createFolder(path);
    return c.json({ ok: true, path }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// Import a document
notesApi.post("/import", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = ImportDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, 400);
  }
  const { filePath, to } = parsed.data;
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

// Delete a folder
notesApi.delete("/folder", async (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path is required" }, 400);
  try {
    await deleteFolder(path);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 404);
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
