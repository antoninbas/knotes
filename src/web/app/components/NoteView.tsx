import { marked } from "marked";
import DOMPurify from "dompurify";
import type { NoteResult } from "../lib/api.ts";

interface Props {
  note: NoteResult;
}

/** Render markdown to sanitized HTML using marked + DOMPurify. */
function renderMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(raw);
}

export default function NoteView(props: Props) {
  return (
    <div class="max-w-3xl mx-auto">
      <div class="mb-4 flex items-center gap-2 flex-wrap">
        {props.note.tags.map((tag) => (
          <span
            class="text-xs px-2 py-0.5 rounded"
            style={{ background: "var(--color-bg-surface)", color: "var(--color-accent)" }}
          >
            {tag}
          </span>
        ))}
        <span class="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Modified: {new Date(props.note.modified).toLocaleString()}
        </span>
      </div>
      <article
        class="markdown-body"
        innerHTML={renderMarkdown(props.note.content)}
      />
    </div>
  );
}
