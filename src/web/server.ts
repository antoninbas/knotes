import { Hono } from "hono";
import { cors } from "hono/cors";
import { join } from "path";
import { notesApi } from "./api/notes.ts";
import { logsApi } from "./api/logs.ts";
import { searchApi } from "./api/search.ts";
import { embeddedAssets } from "./embedded-assets.ts";
import { updateIndex, embed } from "../core/search.ts";
import { getConfig } from "../core/config.ts";

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

  // API routes
  app.route("/api/notes", notesApi);
  app.route("/api/logs", logsApi);
  app.route("/api/search", searchApi);

  return app;
}

export function createWebServer(port: number) {
  const app = createApp();

  const hasEmbeddedAssets = Object.keys(embeddedAssets).length > 0;

  app.get("/*", async (c) => {
    const url = new URL(c.req.url);
    const urlPath = url.pathname === "/" ? "/index.html" : url.pathname;

    // 1. Try embedded assets (compiled binary)
    if (hasEmbeddedAssets) {
      const asset = embeddedAssets[urlPath];
      if (asset) {
        return new Response(asset.content, {
          headers: { "Content-Type": asset.mime },
        });
      }
      // SPA fallback: serve index.html for unknown routes
      const index = embeddedAssets["/index.html"];
      if (index) {
        return new Response(index.content, {
          headers: { "Content-Type": "text/html" },
        });
      }
    }

    // 2. Try files on disk (development)
    const distPath = join(import.meta.dir, "app", "dist", urlPath);
    const file = Bun.file(distPath);
    if (await file.exists()) {
      const ext = urlPath.split(".").pop() || "";
      return new Response(file, {
        headers: { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" },
      });
    }

    // SPA fallback from disk
    const indexPath = join(import.meta.dir, "app", "dist", "index.html");
    const indexFile = Bun.file(indexPath);
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Development fallback
    return c.html(DEV_HTML);
  });

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: app.fetch,
  });

  // Background task: update index + embeddings periodically
  const config = getConfig();
  const intervalMs = config.embedInterval * 1000;

  async function backgroundEmbed() {
    try {
      await updateIndex();
      await embed();
    } catch (err) {
      console.error("Background embed task failed:", err);
    }
  }

  // Run immediately on startup, then on interval
  backgroundEmbed();
  setInterval(backgroundEmbed, intervalMs);

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
