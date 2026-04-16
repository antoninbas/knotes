import { Hono } from "hono";
import { z } from "zod";
import { search, updateIndex, embed } from "../../core/search.ts";
import { getLastJob } from "../../core/db.ts";

const IndexSchema = z.object({
  force: z.boolean().optional(),
});

const EmbedSchema = z.object({
  force: z.boolean().optional(),
});

export const searchApi = new Hono();

searchApi.get("/", async (c) => {
  const query = c.req.query("q");
  if (!query) return c.json({ error: "q (query) is required" }, 400);

  const limit = c.req.query("limit");
  const mode = c.req.query("mode") as "hybrid" | "bm25" | "vector" | undefined;
  const rerankParam = c.req.query("rerank");
  const queryExpandParam = c.req.query("queryExpand");

  try {
    const results = await search(query, {
      limit: limit ? parseInt(limit, 10) : undefined,
      mode,
      rerank: rerankParam !== undefined ? rerankParam === "true" : undefined,
      queryExpand: queryExpandParam !== undefined ? queryExpandParam === "true" : undefined,
    });
    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Trigger index update
searchApi.post("/index", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = IndexSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, 400);
  }
  try {
    await updateIndex({ force: parsed.data.force });
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Trigger embedding (fire-and-forget — job status trackable via GET /api/jobs)
searchApi.post("/embed", async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = EmbedSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, 400);
  }
  embed({ force: parsed.data.force, trigger: "on-demand" }).catch(() => {
    // errors are recorded in the jobs table via recordJobFailed
  });
  return c.json({ ok: true });
});

// Get last embed job status
searchApi.get("/embed/status", async (c) => {
  try {
    const last = getLastJob("embed");
    return c.json({ lastJob: last ?? null });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
