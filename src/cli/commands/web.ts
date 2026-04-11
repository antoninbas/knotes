import type { Command } from "commander";
import { ensureHome, getConfig } from "../../core/config.ts";

export function registerWebCommand(program: Command): void {
  program
    .command("web")
    .description("Start the web interface")
    .option("-p, --port <port>", "Port number")
    .option("-H, --host <host>", "Hostname to bind to")
    .action(async (opts) => {
      await ensureHome();
      const config = getConfig();
      const port = opts.port ? parseInt(opts.port, 10) : config.webPort;
      const host = opts.host as string | undefined;

      const { createWebServer } = await import("../../web/server.ts");
      const server = createWebServer(port, host);
      console.log(`Knotes web UI running at http://${host || "localhost"}:${port}`);
    });
}
