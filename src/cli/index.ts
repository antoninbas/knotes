import { Command } from "commander";
import { registerNoteCommands } from "./commands/note.ts";
import { registerLogCommands } from "./commands/log.ts";
import { registerSearchCommand } from "./commands/search.ts";
import { registerImportCommand } from "./commands/import.ts";
import { registerWebCommand } from "./commands/web.ts";
import { registerMcpCommand } from "./commands/mcp.ts";

export const program = new Command();

program
  .name("knotes")
  .description("A local-first note and activity log manager with hybrid search")
  .version("0.1.0");

registerNoteCommands(program);
registerLogCommands(program);
registerSearchCommand(program);
registerImportCommand(program);
registerWebCommand(program);
registerMcpCommand(program);
