import type { NoteResult } from "../lib/api.ts";

interface Props {
  note: NoteResult;
}

/** Simple markdown rendering — converts basic markdown to HTML. */
function renderMarkdown(md: string): string {
  let html = md
    // Headers
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Bold and italic
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>")
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Horizontal rules
    .replace(/^---$/gm, "<hr>")
    // Line breaks to paragraphs
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");

  return `<p>${html}</p>`;
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
        class="prose"
        style={{ color: "var(--color-text-primary)" }}
        innerHTML={renderMarkdown(props.note.content)}
      />
    </div>
  );
}
