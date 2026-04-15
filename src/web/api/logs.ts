import { Hono } from "hono";
import { z } from "zod";
import { ensureHome } from "../../core/config.ts";
import {
  createLog,
  addEntry,
  listEntries,
  updateEntry,
  deleteEntry,
} from "../../core/logs.ts";

const CreateLogSchema = z.object({
  path: z.string().min(1, "path is required"),
  title: z.string().optional(),
});

const AddEntrySchema = z.object({
  path: z.string().min(1, "path is required"),
  content: z.string().min(1, "content is required"),
});

const UpdateEntrySchema = z.object({
  path: z.string().min(1, "path is required"),
  entryId: z.string().min(1, "entryId is required"),
  content: z.string().min(1, "content is required"),
});

export const logsApi = new Hono();

// Create a new log
logsApi.post("/", async (c) => {
  await ensureHome();
  const raw = await c.req.json().catch(() => null);
  const parsed = CreateLogSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, 400);
  }
  const { path, title } = parsed.data;
  try {
    await createLog(path, title);
    return c.json({ ok: true, path }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// List entries in a log
logsApi.get("/entries", async (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path is required" }, 400);
  const limit = c.req.query("limit");
  try {
    const entries = await listEntries(path, {
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return c.json(entries);
  } catch (err: any) {
    return c.json({ error: err.message }, 404);
  }
});

// Add an entry to a log
logsApi.post("/entries", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = AddEntrySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, 400);
  }
  const { path, content } = parsed.data;
  try {
    const entry = await addEntry(path, content);
    return c.json(entry, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// Update an entry
logsApi.put("/entries", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = UpdateEntrySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, 400);
  }
  const { path, entryId, content } = parsed.data;
  try {
    const entry = await updateEntry(path, entryId, content);
    return c.json(entry);
  } catch (err: any) {
    return c.json({ error: err.message }, 404);
  }
});

// Delete an entry from a log
logsApi.delete("/entries", async (c) => {
  const path = c.req.query("path");
  const entryId = c.req.query("entryId");
  if (!path) return c.json({ error: "path is required" }, 400);
  if (!entryId) return c.json({ error: "entryId is required" }, 400);
  try {
    await deleteEntry(path, entryId);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 404);
  }
});
