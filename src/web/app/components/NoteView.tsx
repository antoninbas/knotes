import { marked } from "marked";
import DOMPurify from "dompurify";
import type { NoteResult } from "../lib/api.ts";

interface Props {
  note: NoteResult;
  onCheckboxToggle?: (newContent: string) => void;
}

function renderMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  const sanitized = DOMPurify.sanitize(raw);
  // Remove disabled so task-list checkboxes are interactive
  return sanitized.replace(/(<input\b[^>]*)\bdisabled(?:="")?([^>]*>)/gi, "$1$2");
}

function toggleNthCheckbox(content: string, index: number): string {
  let count = 0;
  return content.replace(/^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]/gm, (match, prefix, state) => {
    if (count++ === index) {
      return `${prefix}[${state.trim() === "" ? "x" : " "}]`;
    }
    return match;
  });
}

export default function NoteView(props: Props) {
  let articleRef: HTMLElement | undefined;

  function handleClick(e: MouseEvent) {
    if (!props.onCheckboxToggle || !articleRef) return;
    const target = e.target as HTMLElement;
    if (target.tagName !== "INPUT" || (target as HTMLInputElement).type !== "checkbox") return;
    e.preventDefault();

    const checkboxes = Array.from(articleRef.querySelectorAll('input[type="checkbox"]'));
    const index = checkboxes.indexOf(target as HTMLInputElement);
    if (index === -1) return;

    props.onCheckboxToggle(toggleNthCheckbox(props.note.content, index));
  }

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
        ref={articleRef}
        class="markdown-body"
        innerHTML={renderMarkdown(props.note.content)}
        onClick={handleClick}
        style={props.onCheckboxToggle ? { "cursor": "auto" } : undefined}
      />
    </div>
  );
}
