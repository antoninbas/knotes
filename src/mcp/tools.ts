import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createNote,
  getNote,
  updateNote,
  deleteNote,
  listNotes,
} from "../core/notes.ts";
import {
  addEntry,
  listEntries,
  deleteEntry,
} from "../core/logs.ts";
import { search } from "../core/search.ts";
import { importDocument, checkMarkitdown } from "../core/importer.ts";

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

export function registerTools(server: McpServer): void {
  // --- Note tools ---

  server.tool(
    "knotes_note_create",
    "Create a new note at a given path in the hierarchy",
    {
      path: z.string().describe("Logical path (e.g. notes/projects/foo)"),
      title: z.string().optional().describe("Note title"),
      content: z.string().optional().describe("Note content (markdown)"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags for the note"),
    },
    async ({ path, title, content, tags }) => {
      const result = await createNote(path, { title, content, tags });
      return text(`Created note: ${result.path} (${result.title})`);
    }
  );

  server.tool(
    "knotes_note_get",
    "Get the content of a note",
    {
      path: z.string().describe("Logical path of the note"),
    },
    async ({ path }) => {
      const result = await getNote(path);
      return text(
        `# ${result.title}\n\nPath: ${result.path}\nCreated: ${result.created}\nModified: ${result.modified}\nTags: ${result.tags.join(", ") || "none"}\n\n${result.content}`
      );
    }
  );

  server.tool(
    "knotes_note_update",
    "Update an existing note's content or metadata",
    {
      path: z.string().describe("Logical path of the note"),
      title: z.string().optional().describe("New title"),
      content: z.string().optional().describe("New content (markdown)"),
      tags: z
        .array(z.string())
        .optional()
        .describe("New tags"),
    },
    async ({ path, title, content, tags }) => {
      const result = await updateNote(path, { title, content, tags });
      return text(`Updated note: ${result.path}`);
    }
  );

  server.tool(
    "knotes_note_delete",
    "Delete a note",
    {
      path: z.string().describe("Logical path of the note to delete"),
    },
    async ({ path }) => {
      await deleteNote(path);
      return text(`Deleted note: ${path}`);
    }
  );

  server.tool(
    "knotes_note_list",
    "List notes and directories at a given path",
    {
      prefix: z
        .string()
        .optional()
        .describe("Path prefix to list under (e.g. notes/projects)"),
    },
    async ({ prefix }) => {
      const entries = await listNotes(prefix);
      if (entries.length === 0) return text("No entries found.");

      const lines = entries.map((e) => {
        const icon =
          e.type === "directory" ? "📁" : e.type === "log" ? "📋" : "📄";
        return `${icon} ${e.path} — ${e.title}`;
      });
      return text(lines.join("\n"));
    }
  );

  // --- Log tools ---

  server.tool(
    "knotes_log_add",
    "Add a new entry to a log/journal document",
    {
      path: z
        .string()
        .describe("Logical path of the log (e.g. logs/daily)"),
      content: z.string().describe("Entry content (markdown)"),
    },
    async ({ path, content }) => {
      const entry = await addEntry(path, content);
      return text(
        `Added entry ${entry.id} at ${entry.timestamp} to ${path}`
      );
    }
  );

  server.tool(
    "knotes_log_list",
    "List entries in a log/journal document",
    {
      path: z.string().describe("Logical path of the log"),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of entries to return"),
    },
    async ({ path, limit }) => {
      const entries = await listEntries(path, { limit });
      if (entries.length === 0) return text("No entries found.");

      const lines = entries.map((e) => {
        const date = new Date(e.timestamp).toLocaleString();
        const preview =
          e.content.length > 100
            ? e.content.slice(0, 100) + "..."
            : e.content;
        return `[${e.id}] ${date}\n${preview}`;
      });
      return text(lines.join("\n\n"));
    }
  );

  server.tool(
    "knotes_log_delete",
    "Delete an entry from a log/journal document",
    {
      path: z.string().describe("Logical path of the log"),
      entryId: z
        .string()
        .describe("Entry ID to delete (e.g. e-3f7a)"),
    },
    async ({ path, entryId }) => {
      await deleteEntry(path, entryId);
      return text(`Deleted entry ${entryId} from ${path}`);
    }
  );

  // --- Search tools ---

  server.tool(
    "knotes_search",
    "Search through notes and logs using hybrid search (BM25 + vector)",
    {
      query: z.string().describe("Search query"),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of results (default: 10)"),
      mode: z
        .enum(["hybrid", "bm25", "vector"])
        .optional()
        .describe("Search mode (default: hybrid)"),
    },
    async ({ query, limit, mode }) => {
      const results = await search(query, { limit, mode });
      if (results.length === 0) return text("No results found.");

      const lines = results.map(
        (r) =>
          `${r.path} (score: ${r.score.toFixed(3)})\n  ${r.title}\n  ${r.snippet.slice(0, 150).replace(/\n/g, " ")}`
      );
      return text(lines.join("\n\n"));
    }
  );

  // --- Import tool ---

  server.tool(
    "knotes_import",
    "Import an external document (PDF, DOCX, etc.) as a markdown note. Requires markitdown.",
    {
      filePath: z
        .string()
        .describe("Absolute path to the file to import"),
      to: z
        .string()
        .optional()
        .describe("Target logical path for the imported note"),
    },
    async ({ filePath, to }) => {
      const available = await checkMarkitdown();
      if (!available) {
        return text(
          "Error: markitdown is not installed. Install with: pip install 'markitdown[all]'"
        );
      }
      const result = await importDocument(filePath, { to });
      return text(`Imported as: ${result.path} (${result.title})`);
    }
  );
}
