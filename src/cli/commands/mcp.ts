import type { Command } from "commander";
import { ensureHome } from "../../core/config.ts";

export function registerMcpCommand(program: Command): void {
  program
    .command("mcp")
    .description("Start the MCP server (stdio transport)")
    .option("--read-only", "Only expose read-only tools (no create/update/delete)")
    .action(async (opts) => {
      await ensureHome();
      const { startMcpServer } = await import("../../mcp/index.ts");
      await startMcpServer({ readOnly: opts.readOnly });
    });
}
