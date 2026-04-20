import { mkdtemp, rm, cp } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { PINNED_CONFIG } from "./fixtures/pinned-config.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(__dirname, "corpus");
const PROJECT_ROOT = join(__dirname, "../..");

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as { port: number };
      srv.close(() => resolve(addr.port));
    });
    srv.on("error", reject);
  });
}

async function prepareHome(home: string, serverless: boolean) {
  process.env["KNOTES_HOME"] = home;
  const { resetConfigCache, ensureHome, saveConfig } = await import("../../src/core/config.ts");
  const { resetDb } = await import("../../src/core/db.ts");
  const { resetStore, updateIndex } = await import("../../src/core/search.ts");
  resetConfigCache();
  resetDb();
  resetStore();
  await ensureHome();
  await saveConfig({
    serverless,
    rerank: PINNED_CONFIG.rerank,
    queryExpand: PINNED_CONFIG.queryExpand,
    embedInterval: PINNED_CONFIG.embedInterval,
    embedModel: PINNED_CONFIG.embedModel,
  });
  await cp(join(CORPUS_DIR, "notes"), join(home, "notes"), { recursive: true });
  await cp(join(CORPUS_DIR, "logs"), join(home, "logs"), { recursive: true });
  await updateIndex();
  resetDb();
  resetStore();
  resetConfigCache();
  delete process.env["KNOTES_HOME"];
}

export async function setup() {
  const serverlessHome = await mkdtemp(join(tmpdir(), "knotes-e2e-serverless-"));
  const serverHome = await mkdtemp(join(tmpdir(), "knotes-e2e-server-"));

  await prepareHome(serverlessHome, true);
  await prepareHome(serverHome, false);

  const port = await getFreePort();
  const tsxBin = join(PROJECT_ROOT, "node_modules/.bin/tsx");
  // stdio[0] is a real pipe (not "ignore") so the server can detect our death
  // via EOF on stdin — see installStdinWatchdog in src/cli/commands/server.ts.
  // The kernel closes the write end the moment this process exits for any
  // reason (clean teardown, SIGKILL, OOM), so the server can never miss it.
  // detached:true puts the server in its own process group so we can tear
  // the whole subtree (tsx wrapper + server) down in one signal on teardown.
  const serverProcess = spawn(tsxBin, ["src/main.ts", "server", "--port", String(port)], {
    env: {
      ...process.env,
      KNOTES_HOME: serverHome,
      KNOTES_E2E_WATCH_STDIN: "1",
    },
    cwd: PROJECT_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  serverProcess.stdout?.on("data", () => {});
  serverProcess.stderr?.on("data", () => {});

  const deadline = Date.now() + 20_000;
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (resp.ok) {
        healthy = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!healthy) throw new Error("E2E server did not start within 20 seconds");

  process.env["E2E_SERVERLESS_HOME"] = serverlessHome;
  process.env["E2E_SERVER_HOME"] = serverHome;
  process.env["E2E_SERVER_PORT"] = String(port);

  return async () => {
    const pgid = serverProcess.pid;
    const killGroup = (sig: NodeJS.Signals) => {
      if (pgid == null) return;
      try { process.kill(-pgid, sig); } catch {}
    };
    // Closing stdin triggers the server's EOF watchdog (clean exit path).
    // The SIGTERM/SIGKILL fallbacks below cover anything that wasn't
    // listening on stdin (e.g. the tsx wrapper between us and the server).
    serverProcess.stdin?.end();
    killGroup("SIGTERM");
    await new Promise<void>((resolve) => {
      serverProcess.once("exit", () => resolve());
      setTimeout(() => {
        killGroup("SIGKILL");
        setTimeout(resolve, 500);
      }, 2000);
    });
    await rm(serverlessHome, { recursive: true, force: true });
    await rm(serverHome, { recursive: true, force: true });
  };
}
