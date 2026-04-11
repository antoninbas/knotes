import type { Command } from "commander";
import { ensureHome } from "../../core/config.ts";

export function registerMcpCommand(program: Command): void {
  program
    .command("mcp")
    .description("Start the MCP server (stdio transport)")
    .action(async () => {
      await ensureHome();
      const { startMcpServer } = await import("../../mcp/index.ts");
      await startMcpServer();
    });
}
