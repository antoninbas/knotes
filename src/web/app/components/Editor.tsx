import { createSignal } from "solid-js";
import { notes, type NoteResult } from "../lib/api.ts";

interface Props {
  note: NoteResult;
  onSave: (updated: NoteResult) => void;
}

export default function Editor(props: Props) {
  const [content, setContent] = createSignal(props.note.content);
  const [title, setTitle] = createSignal(props.note.title);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updated = await notes.update(props.note.path, {
        title: title(),
        content: content(),
      });
      props.onSave(updated);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Save with Ctrl+S
  function handleKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
  }

  return (
    <div class="max-w-3xl mx-auto space-y-4" onKeyDown={handleKeyDown}>
      <input
        type="text"
        value={title()}
        onInput={(e) => setTitle(e.currentTarget.value)}
        class="w-full text-2xl font-bold bg-transparent border-none outline-none"
        style={{ color: "var(--color-text-primary)" }}
        placeholder="Note title"
      />
      <textarea
        value={content()}
        onInput={(e) => setContent(e.currentTarget.value)}
        class="w-full min-h-[60vh] p-4 rounded border outline-none resize-y font-mono text-sm"
        style={{
          "background-color": "var(--color-bg-surface)",
          "border-color": "var(--color-border)",
          color: "var(--color-text-primary)",
        }}
        placeholder="Write your note in markdown..."
      />
      <div class="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving()}
          class="px-4 py-2 rounded text-sm font-medium cursor-pointer disabled:opacity-50"
          style={{ background: "var(--color-accent)", color: "#fff" }}
        >
          {saving() ? "Saving..." : "Save (Ctrl+S)"}
        </button>
        {error() && (
          <span class="text-sm" style={{ color: "var(--color-danger)" }}>
            {error()}
          </span>
        )}
      </div>
    </div>
  );
}
