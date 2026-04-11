import { Hono } from "hono";
import { search } from "../../core/search.ts";

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
