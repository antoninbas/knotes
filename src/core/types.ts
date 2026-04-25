export interface KnotesConfig {
  home: string;
  editor: string;
  webPort: number;
  theme: "light" | "dark" | "system";
  /** Interval in seconds for the background embed task (default: 300). */
  embedInterval: number;
  /** When true, CLI/MCP operate directly without requiring a running server. */
  serverless: boolean;
  /** Custom embedding model URI (HuggingFace GGUF). Empty string = qmd default. */
  embedModel: string;
  /** Custom query expansion model URI (HuggingFace GGUF). Empty string = qmd default. */
  queryExpansionModel: string;
  /** Custom reranker model URI (HuggingFace GGUF). Empty string = qmd default. */
  rerankModel: string;
  /** Enable LLM reranking in hybrid search (default: false — slow on CPU). */
  rerank: boolean;
  /** Enable LLM query expansion in hybrid search (default: false — slow on CPU). */
  queryExpand: boolean;
  /** Enable the background GitHub sync loop (default: true). */
  githubEnabled: boolean;
  /** Interval in seconds for the background GitHub sync loop (default: 600). */
  githubSyncInterval: number;
}

export interface NoteMeta {
  title: string;
  created: string;
  modified: string;
  tags: string[];
  type: "note" | "log";
  /** Optional description — used by log journals as context for search. */
  description?: string;
}

export interface NoteResult {
  /** Logical path relative to KNOTES_HOME, without .md extension */
  path: string;
  /** Absolute filesystem path */
  filePath: string;
  title: string;
  created: string;
  modified: string;
  tags: string[];
  type: "note" | "log";
  content: string;
  /** Optional description — only present on log journals. */
  description?: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  content: string;
}

export type SearchMode = "hybrid" | "bm25" | "vector";

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

export interface ListEntry {
  path: string;
  title: string;
  type: "note" | "log" | "directory";
  modified?: string;
}

export interface CreateNoteOptions {
  title?: string;
  content?: string;
  tags?: string[];
  description?: string;
}

export interface UpdateNoteOptions {
  title?: string;
  content?: string;
  tags?: string[];
}
