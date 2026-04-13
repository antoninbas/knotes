import { Hono } from "hono";
import { getJobs } from "../../core/db.ts";

export const jobsApi = new Hono();

jobsApi.get("/", (c) => {
  const page = parseInt(c.req.query("page") ?? "1", 10);
  const pageSize = parseInt(c.req.query("pageSize") ?? "20", 10);
  const type = c.req.query("type") || undefined;

  const result = getJobs({ page, pageSize, type });
  return c.json(result);
});
