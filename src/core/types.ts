export interface KnotesConfig {
  home: string;
  editor: string;
  webPort: number;
  theme: "light" | "dark" | "system";
}

export interface NoteMeta {
  title: string;
  created: string;
  modified: string;
  tags: string[];
  type: "note" | "log";
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
}

export interface LogEntry {
  id: string;
  timestamp: string;
  content: string;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

export interface CreateNoteOptions {
  title?: string;
  content?: string;
  tags?: string[];
}

export interface UpdateNoteOptions {
  title?: string;
  content?: string;
  tags?: string[];
}
