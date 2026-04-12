import { Hono } from "hono";
import { search, updateIndex, embed } from "../../core/search.ts";
import { getLastJob } from "../../core/db.ts";

export const searchApi = new Hono();

searchApi.get("/", async (c) => {
  const query = c.req.query("q");
  if (!query) return c.json({ error: "q (query) is required" }, 400);

  const limit = c.req.query("limit");
  const mode = c.req.query("mode") as "hybrid" | "bm25" | "vector" | undefined;

  try {
    const results = await search(query, {
      limit: limit ? parseInt(limit, 10) : undefined,
      mode,
    });
    return c.json(results);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Trigger index update
searchApi.post("/index", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    await updateIndex({ force: body.force });
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Trigger embedding
searchApi.post("/embed", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    await embed({ force: body.force, trigger: "on-demand" });
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Get last embed job status
searchApi.get("/embed/status", async (c) => {
  try {
    const last = getLastJob("embed");
    return c.json({ lastJob: last });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
