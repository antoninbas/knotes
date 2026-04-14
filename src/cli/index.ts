import { Command } from "commander";
import { registerNoteCommands } from "./commands/note.ts";
import { registerLogCommands } from "./commands/log.ts";
import { registerSearchCommand } from "./commands/search.ts";
import { registerImportCommand } from "./commands/import.ts";
import { registerServerCommand } from "./commands/server.ts";
import { registerMcpCommand } from "./commands/mcp.ts";
import { registerConfigCommand } from "./commands/config.ts";
import { registerServiceCommand } from "./commands/service.ts";
import { getVersion } from "../core/version.ts";

export const program = new Command();

program
  .name("knotes")
  .description("A local-first note and activity log manager with hybrid search")
  .version(getVersion());

registerNoteCommands(program);
registerLogCommands(program);
registerSearchCommand(program);
registerImportCommand(program);
registerServerCommand(program);
registerMcpCommand(program);
registerConfigCommand(program);
registerServiceCommand(program);
