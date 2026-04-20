import type { Command } from "commander";
import { ensureHome, getConfig } from "../../core/config.ts";

// Test-only watchdog: when KNOTES_E2E_WATCH_STDIN=1 is set, exit as soon
// as stdin closes. The e2e harness wires its own pipe to our stdin and
// keeps the write end open for the server's lifetime; the kernel closes
// it the moment the harness process dies (including SIGKILL/OOM), so
// reading EOF here is a parent-death signal that can't be missed.
function installStdinWatchdog(): void {
  if (process.env["KNOTES_E2E_WATCH_STDIN"] !== "1") return;
  const exitOnParentGone = () => {
    console.error("E2E watchdog: stdin closed, parent gone, exiting");
    process.exit(0);
  };
  process.stdin.on("data", () => {});
  process.stdin.on("end", exitOnParentGone);
  process.stdin.on("close", exitOnParentGone);
  process.stdin.resume();
}

export function registerServerCommand(program: Command): void {
  program
    .command("server")
    .description("Start the Knotes server (web UI + API)")
    .option("-p, --port <port>", "Port number")
    .action(async (opts) => {
      await ensureHome();
      const config = getConfig();
      const port = opts.port ? parseInt(opts.port, 10) : config.webPort;

      installStdinWatchdog();

      const { createWebServer } = await import("../../web/server.ts");
      const server = createWebServer(port);
      console.log(`Knotes server running at http://localhost:${port}`);
    });
}
