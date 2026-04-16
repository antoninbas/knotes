import { createSignal, createEffect, For, Show } from "solid-js";
import { logs, type LogEntry, type NoteResult } from "../lib/api.ts";

interface Props {
  note: NoteResult;
  readOnly?: boolean;
  onUpdateJournal?: () => void;
}

export default function LogView(props: Props) {
  const [entries, setEntries] = createSignal<LogEntry[]>([]);
  const [newContent, setNewContent] = createSignal("");
  const [adding, setAdding] = createSignal(false);
  const [addError, setAddError] = createSignal<string | null>(null);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editContent, setEditContent] = createSignal("");
  const [editError, setEditError] = createSignal<string | null>(null);
  const [deleteError, setDeleteError] = createSignal<string | null>(null);

  // Description state
  const [editingDesc, setEditingDesc] = createSignal(false);
  const [descInput, setDescInput] = createSignal("");
  const [descSaving, setDescSaving] = createSignal(false);

  // Get description from note frontmatter (stored as extra metadata)
  const description = () => (props.note as any).description as string | undefined;

  async function loadEntries() {
    try {
      const items = await logs.listEntries(props.note.path);
      setEntries(items);
    } catch (err) {
      console.error("Failed to load log entries:", err);
    }
  }

  createEffect(() => {
    const _ = props.note.path;
    loadEntries();
  });

  async function handleAdd() {
    const content = newContent().trim();
    if (!content) return;
    setAdding(true);
    setAddError(null);
    try {
      await logs.addEntry(props.note.path, content);
      setNewContent("");
      await loadEntries();
    } catch (err: any) {
      console.error("Failed to add entry:", err);
      setAddError(err.message || "Failed to add entry. Please try again.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(entry: LogEntry) {
    setEditingId(entry.id);
    setEditContent(entry.content);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditContent("");
    setEditError(null);
  }

  async function handleUpdate(entryId: string) {
    const content = editContent().trim();
    if (!content) return;
    setEditError(null);
    try {
      await logs.updateEntry(props.note.path, entryId, content);
      setEditingId(null);
      setEditContent("");
      await loadEntries();
    } catch (err: any) {
      console.error("Failed to update entry:", err);
      setEditError(err.message || "Failed to update entry. Please try again.");
    }
  }

  async function handleDelete(entryId: string) {
    if (!confirm("Delete this entry?")) return;
    setDeleteError(null);
    try {
      await logs.deleteEntry(props.note.path, entryId);
      await loadEntries();
    } catch (err: any) {
      console.error("Failed to delete entry:", err);
      setDeleteError(err.message || "Failed to delete entry. Please try again.");
    }
  }

  function startEditDesc() {
    setDescInput(description() ?? "");
    setEditingDesc(true);
  }

  async function saveDesc() {
    setDescSaving(true);
    try {
      const text = descInput().trim() || null;
      await logs.updateJournal(props.note.path, { description: text });
      props.onUpdateJournal?.();
      setEditingDesc(false);
    } catch (err: any) {
      console.error("Failed to save description:", err);
    } finally {
      setDescSaving(false);
    }
  }

  return (
    <div class="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 class="text-xl font-bold" style={{ color: "var(--color-text-primary)" }}>
          {props.note.title}
        </h2>

        {/* Description */}
        <Show when={!editingDesc()}>
          <div
            class="mt-1 flex items-start gap-1 group cursor-pointer"
            onClick={() => !props.readOnly && startEditDesc()}
            title={props.readOnly ? undefined : "Click to edit description"}
          >
            <Show when={!props.readOnly}>
              <span
                class="text-xs mt-0.5 shrink-0 opacity-30 group-hover:opacity-60"
                style={{ color: "var(--color-text-muted)" }}
              >
                ✎
              </span>
            </Show>
            <span
              class="text-sm italic"
              style={{ color: "var(--color-text-muted)", opacity: description() ? 0.8 : 0.4 }}
            >
              {description() || (props.readOnly ? "" : "Add a description...")}
            </span>
          </div>
        </Show>
        <Show when={editingDesc()}>
          <div class="mt-2 space-y-2">
            <input
              type="text"
              value={descInput()}
              onInput={(e) => setDescInput(e.currentTarget.value)}
              placeholder="Describe this journal..."
              class="w-full px-2 py-1 text-sm rounded border outline-none"
              style={{
                "background-color": "var(--color-bg-surface)",
                "border-color": "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveDesc();
                if (e.key === "Escape") setEditingDesc(false);
              }}
              // eslint-disable-next-line solid/reactivity
              ref={(el) => setTimeout(() => el?.focus(), 0)}
            />
            <div class="flex gap-2">
              <button
                onClick={saveDesc}
                disabled={descSaving()}
                class="px-3 py-1 text-xs rounded cursor-pointer disabled:opacity-50"
                style={{ background: "var(--color-accent)", color: "#fff" }}
              >
                Save
              </button>
              <button
                onClick={() => setEditingDesc(false)}
                class="px-3 py-1 text-xs rounded cursor-pointer"
                style={{ background: "var(--color-bg-hover)", color: "var(--color-text-secondary)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </Show>
      </div>

      {/* Add entry form */}
      <Show when={!props.readOnly}>
      <div class="space-y-2">
        <textarea
          value={newContent()}
          onInput={(e) => setNewContent(e.currentTarget.value)}
          placeholder="Add a new log entry..."
          rows={3}
          class="w-full p-3 rounded border outline-none resize-y text-sm"
          style={{
            "background-color": "var(--color-bg-surface)",
            "border-color": "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <button
          onClick={handleAdd}
          disabled={adding() || !newContent().trim()}
          class="px-4 py-1.5 rounded text-sm cursor-pointer disabled:opacity-50"
          style={{ background: "var(--color-accent)", color: "#fff" }}
        >
          {adding() ? "Adding..." : "Add Entry (Ctrl+Enter)"}
        </button>
        <Show when={addError()}>
          <p class="text-sm text-red-500">{addError()}</p>
        </Show>
      </div>
      </Show>

      {/* Entries list */}
      <div class="space-y-4">
        <Show when={deleteError()}>
          <p class="text-sm text-red-500">{deleteError()}</p>
        </Show>
        <For each={entries()}>
          {(entry) => (
            <div
              class="p-4 rounded border"
              style={{
                "background-color": "var(--color-bg-surface)",
                "border-color": "var(--color-border)",
              }}
            >
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-mono" style={{ color: "var(--color-text-muted)" }}>
                    {entry.id}
                  </span>
                  <span class="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                </div>
                <Show when={!props.readOnly}>
                <div class="flex items-center gap-2">
                  <Show when={editingId() !== entry.id}>
                    <button
                      onClick={() => startEdit(entry)}
                      class="text-xs px-2 py-0.5 rounded cursor-pointer transition-opacity opacity-50 hover:opacity-100"
                      style={{ color: "var(--color-accent)" }}
                    >
                      Edit
                    </button>
                  </Show>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    class="text-xs px-2 py-0.5 rounded cursor-pointer transition-opacity opacity-50 hover:opacity-100"
                    style={{ color: "var(--color-danger)" }}
                  >
                    Delete
                  </button>
                </div>
                </Show>
              </div>

              <Show
                when={editingId() === entry.id}
                fallback={
                  <div
                    class="text-sm whitespace-pre-wrap"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    {entry.content}
                  </div>
                }
              >
                <textarea
                  value={editContent()}
                  onInput={(e) => setEditContent(e.currentTarget.value)}
                  rows={4}
                  class="w-full p-2 rounded border outline-none resize-y text-sm mb-2"
                  style={{
                    "background-color": "var(--color-bg-primary)",
                    "border-color": "var(--color-border)",
                    color: "var(--color-text-primary)",
                  }}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                      e.preventDefault();
                      handleUpdate(entry.id);
                    }
                    if (e.key === "Escape") cancelEdit();
                  }}
                />
                <Show when={editError()}>
                  <p class="text-xs text-red-500 mb-2">{editError()}</p>
                </Show>
                <div class="flex gap-2">
                  <button
                    onClick={() => handleUpdate(entry.id)}
                    class="px-3 py-1 text-xs rounded cursor-pointer"
                    style={{ background: "var(--color-accent)", color: "#fff" }}
                  >
                    Save (Ctrl+Enter)
                  </button>
                  <button
                    onClick={cancelEdit}
                    class="px-3 py-1 text-xs rounded cursor-pointer"
                    style={{ background: "var(--color-bg-hover)", color: "var(--color-text-secondary)" }}
                  >
                    Cancel
                  </button>
                </div>
              </Show>
            </div>
          )}
        </For>

        <Show when={entries().length === 0}>
          <p class="text-center py-8" style={{ color: "var(--color-text-muted)" }}>
            No entries yet. Add one above.
          </p>
        </Show>
      </div>
    </div>
  );
}
