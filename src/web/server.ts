import { Hono } from "hono";
import { cors } from "hono/cors";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { notesApi } from "./api/notes.ts";
import { logsApi } from "./api/logs.ts";
import { searchApi } from "./api/search.ts";
import { jobsApi } from "./api/jobs.ts";
import { configApi } from "./api/config.ts";
import { contextApi } from "./api/context.ts";
import { githubApi } from "./api/github.ts";
import { vaultApi } from "./api/vault.ts";
import { updateIndex, embed } from "../core/search.ts";
import { syncAll as githubSyncAll } from "../core/github/sync.ts";
import { getVersion } from "../core/version.ts";
import { getConfig } from "../core/config.ts";
import {
  writeServerHeartbeat,
  updateHeartbeat,
  clearServerInfo,
  isServerAlive,
  getServerInfo,
} from "../core/db.ts";
import { tryAutoUnlock, ensureVaultExists } from "../core/vault.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  app.use(
    "/api/*",
    cors({
      origin: (origin) => {
        if (!origin) return null;
        try {
          const { hostname } = new URL(origin);
          if (hostname === "localhost" || hostname === "127.0.0.1") {
            return origin;
          }
        } catch {
          // invalid origin
        }
        return null;
      },
    })
  );

  // Health check
  app.get("/api/health", (c) => c.json({ ok: true }));

  // Version
  app.get("/api/version", (c) => c.text(getVersion()));

  // API routes
  app.route("/api/notes", notesApi);
  app.route("/api/logs", logsApi);
  app.route("/api/search", searchApi);
  app.route("/api/jobs", jobsApi);
  app.route("/api/config", configApi);
  app.route("/api/context", contextApi);
  app.route("/api/github", githubApi);
  app.route("/api/vault", vaultApi);

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

  // Ensure vault file exists so the UI always shows the vault status
  ensureVaultExists();

  // Auto-unlock vault if KNOTES_VAULT_PASSPHRASE is set
  tryAutoUnlock();

  app.get("/*", async (c) => {
    const url = new URL(c.req.url);
    const urlPath = url.pathname === "/" ? "/index.html" : url.pathname;

    // Try files on disk
    const distPath = join(__dirname, "app", "dist", urlPath);
    if (existsSync(distPath)) {
      const ext = urlPath.split(".").pop() || "";
      const content = await readFile(distPath);
      return new Response(content, {
        headers: { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" },
      });
    }

    // SPA fallback
    const indexPath = join(__dirname, "app", "dist", "index.html");
    if (existsSync(indexPath)) {
      const content = await readFile(indexPath);
      return new Response(content, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Frontend not built / service restart pending
    return c.html(process.env.KNOTES_BIN ? PROD_HTML : DEV_HTML);
  });

  const hostname = "127.0.0.1";

  const server = serve({
    fetch: app.fetch,
    port,
    hostname,
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

  // Background task: GitHub activity sync
  let ghRunning = false;
  async function backgroundGithubSync() {
    const cfg = getConfig();
    if (!cfg.githubEnabled) return;
    if (ghRunning) return;
    ghRunning = true;
    try {
      await githubSyncAll({ trigger: "background" });
    } catch (err) {
      console.error("GitHub sync failed:", err);
    } finally {
      ghRunning = false;
    }
  }
  // Stagger the first run so it doesn't compete with the embed kickoff.
  const ghStartTimer = setTimeout(backgroundGithubSync, 5_000);
  const ghInterval = setInterval(
    backgroundGithubSync,
    config.githubSyncInterval * 1000
  );

  // Graceful shutdown
  function cleanup() {
    clearInterval(heartbeatInterval);
    clearInterval(embedInterval);
    clearTimeout(ghStartTimer);
    clearInterval(ghInterval);
    clearServerInfo();
    server.close();
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

const PROD_HTML = `<!DOCTYPE html>
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
    <p>The service was recently upgraded. Restart it to apply the update.</p>
  </div>
</body>
</html>`;

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
    <p><code>cd src/web/app && npm install && npx vite build</code></p>
    <p>The API is available at <code>/api</code></p>
  </div>
</body>
</html>`;
