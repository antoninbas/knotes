import { Hono } from "hono";
import { cors } from "hono/cors";
import { join } from "path";
import { notesApi } from "./api/notes.ts";
import { logsApi } from "./api/logs.ts";
import { searchApi } from "./api/search.ts";
import { jobsApi } from "./api/jobs.ts";
import { updateIndex, embed } from "../core/search.ts";
import { getVersion } from "../core/version.ts";
import { getConfig } from "../core/config.ts";
import {
  writeServerHeartbeat,
  updateHeartbeat,
  clearServerInfo,
  isServerAlive,
  getServerInfo,
} from "../core/db.ts";

const MIME_TYPES: Record<string, string> = {
  html: "text/html",
  js: "application/javascript",
  css: "text/css",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
};

export function createApp(): Hono {
  const app = new Hono();

  app.use("/api/*", cors());

  // Health check
  app.get("/api/health", (c) => c.json({ ok: true }));

  // Version
  app.get("/api/version", (c) => c.text(getVersion()));

  // API routes
  app.route("/api/notes", notesApi);
  app.route("/api/logs", logsApi);
  app.route("/api/search", searchApi);
  app.route("/api/jobs", jobsApi);

  return app;
}

export function createWebServer(port: number) {
  // Check if another server is already running
  if (isServerAlive()) {
    const info = getServerInfo()!;
    console.error(
      `Error: Another server is already running (PID ${info.pid} on port ${info.port}, started ${info.started_at}).`
    );
    console.error("Stop the existing server first, or use a different KNOTES_HOME.");
    process.exit(1);
  }

  const app = createApp();

  app.get("/*", async (c) => {
    const url = new URL(c.req.url);
    const urlPath = url.pathname === "/" ? "/index.html" : url.pathname;

    // Try files on disk
    const distPath = join(import.meta.dir, "app", "dist", urlPath);
    const file = Bun.file(distPath);
    if (await file.exists()) {
      const ext = urlPath.split(".").pop() || "";
      return new Response(file, {
        headers: { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" },
      });
    }

    // SPA fallback
    const indexPath = join(import.meta.dir, "app", "dist", "index.html");
    const indexFile = Bun.file(indexPath);
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Frontend not built
    return c.html(DEV_HTML);
  });

  const hostname = "127.0.0.1";

  const server = Bun.serve({
    port,
    hostname,
    fetch: app.fetch,
  });

  // Register server in DB
  writeServerHeartbeat(process.pid, port, hostname);

  // Heartbeat every 30 seconds
  const heartbeatInterval = setInterval(() => {
    updateHeartbeat();
  }, 30_000);

  // Background task: update index + embeddings periodically
  const config = getConfig();
  const intervalMs = config.embedInterval * 1000;

  async function backgroundEmbed() {
    try {
      await updateIndex();
      await embed({ trigger: "background" });
    } catch (err) {
      console.error("Background embed task failed:", err);
    }
  }

  // Run immediately on startup, then on interval
  backgroundEmbed();
  const embedInterval = setInterval(backgroundEmbed, intervalMs);

  // Graceful shutdown
  function cleanup() {
    clearInterval(heartbeatInterval);
    clearInterval(embedInterval);
    clearServerInfo();
    server.stop();
  }

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  return server;
}

const DEV_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Knotes</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex; align-items: center; justify-content: center;
      height: 100vh; margin: 0;
      background: #1e1e2e; color: #cdd6f4;
    }
    .container { text-align: center; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    p { color: #a6adc8; }
    code { background: #313244; padding: 2px 8px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Knotes</h1>
    <p>Web UI is in development. Build the frontend with:</p>
    <p><code>cd src/web/app && bun install && bun run build</code></p>
    <p>The API is available at <code>/api</code></p>
  </div>
</body>
</html>`;
