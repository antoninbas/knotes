import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createNote,
  getNote,
  updateNote,
  deleteNote,
  listNotes,
  createFolder,
  createLog,
  updateLog,
  deleteLog,
  addEntry,
  listEntries,
  listJournals,
  updateEntry,
  deleteEntry,
  search,
  updateIndex,
  embed,
  importDocument,
  listContexts,
  getContext,
  setContext,
  removeContext,
} from "../core/router.ts";

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

export function registerTools(
  server: McpServer,
  options?: { readOnly?: boolean }
): void {
  const readOnly = options?.readOnly ?? false;

  // --- Read-only tools (always registered) ---

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

  server.tool(
    "knotes_log_list_journals",
    "List all journal documents (logs)",
    {
      prefix: z
        .string()
        .optional()
        .describe("Filter to a sub-path (e.g. logs/work)"),
    },
    async ({ prefix }) => {
      const journals = await listJournals(prefix);
      if (journals.length === 0) return text("No journals found.");
      const lines = journals.map((j) => `${j.path} — ${j.title}`);
      return text(lines.join("\n"));
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
      since: z
        .string()
        .optional()
        .describe("Only return entries at or after this date/time (ISO 8601 or any parseable date, e.g. '2025-04-07T00:00:00Z')"),
      before: z
        .string()
        .optional()
        .describe("Only return entries before this date/time (ISO 8601 or any parseable date, e.g. '2025-04-14T00:00:00Z')"),
    },
    async ({ path, limit, since, before }) => {
      const entries = await listEntries(path, { limit, since, before });
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
        .describe("Search mode: hybrid (BM25 + vector, default), bm25 (keyword only), vector (semantic only)"),
      rerank: z
        .boolean()
        .optional()
        .describe("Enable LLM reranking for higher quality results (hybrid mode only, slow on CPU)"),
      queryExpand: z
        .boolean()
        .optional()
        .describe("Enable LLM query expansion for broader recall (hybrid mode only, slow on CPU)"),
      collections: z
        .array(z.enum(["notes", "logs"]))
        .optional()
        .describe("Restrict results to specific collections (notes, logs). Defaults to both."),
    },
    async ({ query, limit, mode, rerank, queryExpand, collections }) => {
      const results = await search(query, { limit, mode, rerank, queryExpand, collections });
      if (results.length === 0) return text("No results found.");

      const lines = results.map(
        (r) =>
          `${r.path} (score: ${r.score.toFixed(3)})\n  ${r.title}\n  ${r.snippet.slice(0, 150).replace(/\n/g, " ")}`
      );
      return text(lines.join("\n\n"));
    }
  );

  server.tool(
    "knotes_index",
    "Update the search index (always incremental)",
    {},
    async () => {
      await updateIndex();
      return text("Search index updated.");
    }
  );

  server.tool(
    "knotes_embed",
    "Generate embeddings for vector/hybrid search (incremental by default)",
    {
      force: z
        .boolean()
        .optional()
        .describe("Recompute all embeddings instead of incremental"),
    },
    async ({ force }) => {
      await updateIndex();
      await embed({ force });
      return text("Embeddings updated.");
    }
  );

  // --- Write tools (only in read-write mode) ---

  if (readOnly) return;

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
    "knotes_folder_create",
    "Create a new folder in the hierarchy",
    {
      path: z.string().describe("Folder path (e.g. notes/projects)"),
    },
    async ({ path }) => {
      await createFolder(path);
      return text(`Created folder: ${path}`);
    }
  );

  server.tool(
    "knotes_log_create",
    "Create a new log/journal document",
    {
      path: z.string().describe("Logical path for the log (e.g. logs/daily)"),
      title: z.string().optional().describe("Log title"),
      description: z.string().optional().describe("Journal description (also used as search context hint)"),
    },
    async ({ path, title, description }) => {
      await createLog(path, title, description);
      return text(`Created log: ${path}`);
    }
  );

  server.tool(
    "knotes_log_add",
    "Add a new entry to an existing log/journal document",
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
    "knotes_log_update",
    "Update an existing log entry's content (preserves timestamp and order)",
    {
      path: z.string().describe("Logical path of the log"),
      entryId: z.string().describe("Entry ID to update (e.g. e-3f7a)"),
      content: z.string().describe("New entry content"),
    },
    async ({ path, entryId, content }) => {
      const entry = await updateEntry(path, entryId, content);
      return text(`Updated entry ${entry.id} in ${path}`);
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
      const result = await importDocument(filePath, { to });
      return text(`Imported as: ${result.path} (${result.title})`);
    }
  );

  // --- Context tools (read-only) ---

  server.tool(
    "knotes_context_list",
    "List all search context hints for folders and journals",
    {},
    async () => {
      const entries = await listContexts();
      if (entries.length === 0) return text("No context hints set.");
      const lines = entries.map(({ path, context }) => `${path}\n  ${context}`);
      return text(lines.join("\n\n"));
    }
  );

  server.tool(
    "knotes_context_get",
    "Get the search context hint for a specific folder or journal path",
    {
      path: z.string().describe("Logical path (e.g. notes/projects or logs/daily)"),
    },
    async ({ path }) => {
      const context = await getContext(path);
      if (context === undefined) return text(`No context set for: ${path}`);
      return text(context);
    }
  );

  if (!readOnly) {
    server.tool(
      "knotes_context_set",
      "Set a search context hint for a folder or journal path. Context hints help qmd understand the content of a folder when searching.",
      {
        path: z.string().describe("Logical path (e.g. notes/projects or logs/daily)"),
        context: z.string().describe("Context description for this path"),
      },
      async ({ path, context }) => {
        await setContext(path, context);
        return text(`Context set for: ${path}`);
      }
    );

    server.tool(
      "knotes_context_remove",
      "Remove the search context hint for a path",
      {
        path: z.string().describe("Logical path whose context to remove"),
      },
      async ({ path }) => {
        await removeContext(path);
        return text(`Context removed for: ${path}`);
      }
    );

    server.tool(
      "knotes_log_update_journal",
      "Update a log journal's title and/or description",
      {
        path: z.string().describe("Logical path of the journal"),
        title: z.string().optional().describe("New title"),
        description: z.string().nullable().optional().describe("New description (null or empty string to clear)"),
      },
      async ({ path, title, description }) => {
        await updateLog(path, { title, description });
        return text(`Updated journal: ${path}`);
      }
    );

    server.tool(
      "knotes_log_delete_journal",
      "Delete an entire log journal document",
      {
        path: z.string().describe("Logical path of the journal to delete"),
      },
      async ({ path }) => {
        await deleteLog(path);
        return text(`Deleted journal: ${path}`);
      }
    );
  }
}
