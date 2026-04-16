import { Hono } from "hono";
import { z } from "zod";
import { listContexts, getContext, setContext, removeContext } from "../../core/context.ts";

const SetContextSchema = z.object({
  path: z.string().min(1, "path is required"),
  context: z.string().min(1, "context is required"),
});

export const contextApi = new Hono();

// List all contexts
contextApi.get("/", (_c) => {
  const entries = listContexts();
  return _c.json(entries);
});

// Get context for a specific path
contextApi.get("/get", (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path is required" }, 400);
  const context = getContext(path);
  if (context === undefined) return c.json({ context: null });
  return c.json({ context });
});

// Set context for a path
contextApi.put("/", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = SetContextSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, 400);
  }
  const { path, context } = parsed.data;
  setContext(path, context);
  return c.json({ ok: true });
});

// Remove context for a path
contextApi.delete("/", (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "path is required" }, 400);
  removeContext(path);
  return c.json({ ok: true });
});
