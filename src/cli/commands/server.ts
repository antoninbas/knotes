import type { Command } from "commander";
import { ensureHome, getConfig } from "../../core/config.ts";

export function registerServerCommand(program: Command): void {
  program
    .command("server")
    .description("Start the Knotes server (web UI + API)")
    .option("-p, --port <port>", "Port number")
    .action(async (opts) => {
      await ensureHome();
      const config = getConfig();
      const port = opts.port ? parseInt(opts.port, 10) : config.webPort;

      const { createWebServer } = await import("../../web/server.ts");
      const server = createWebServer(port);
      console.log(`Knotes server running at http://localhost:${port}`);
    });
}
