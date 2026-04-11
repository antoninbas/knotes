import { Hono } from "hono";
import { cors } from "hono/cors";
import { notesApi } from "./api/notes.ts";
import { logsApi } from "./api/logs.ts";
import { searchApi } from "./api/search.ts";

export function createApp(): Hono {
  const app = new Hono();

  app.use("/api/*", cors());

  // API routes
  app.route("/api/notes", notesApi);
  app.route("/api/logs", logsApi);
  app.route("/api/search", searchApi);

  return app;
}

export function createWebServer(port: number, hostname?: string) {
  const app = createApp();

  // In development, serve the frontend via Vite dev server.
  // In production (compiled binary), serve embedded static files.
  // For now, serve a simple HTML page and the SPA will be built with Vite.

  app.get("/*", async (c) => {
    // Try to serve static files from the built frontend
    const url = new URL(c.req.url);
    let filePath = url.pathname === "/" ? "/index.html" : url.pathname;

    // Try embedded files first (for compiled binary)
    try {
      const { join } = await import("path");
      const distPath = join(import.meta.dir, "app", "dist", filePath);
      const file = Bun.file(distPath);
      if (await file.exists()) {
        const ext = filePath.split(".").pop() || "";
        const mimeTypes: Record<string, string> = {
          html: "text/html",
          js: "application/javascript",
          css: "text/css",
          json: "application/json",
          svg: "image/svg+xml",
          png: "image/png",
          ico: "image/x-icon",
        };
        return new Response(file, {
          headers: {
            "Content-Type": mimeTypes[ext] || "application/octet-stream",
          },
        });
      }
    } catch {
      // Not found
    }

    // Fallback: serve the SPA index.html for client-side routing
    try {
      const { join } = await import("path");
      const indexPath = join(import.meta.dir, "app", "dist", "index.html");
      const file = Bun.file(indexPath);
      if (await file.exists()) {
        return new Response(file, {
          headers: { "Content-Type": "text/html" },
        });
      }
    } catch {
      // Not found
    }

    // Development fallback: inline HTML
    return c.html(getDevHtml());
  });

  return Bun.serve({
    port,
    hostname,
    fetch: app.fetch,
  });
}

function getDevHtml(): string {
  return `<!DOCTYPE html>
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
}
