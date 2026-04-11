import { createSignal, createEffect, For, Show } from "solid-js";
import { notes, type ListEntry, type NoteResult } from "../lib/api.ts";

interface Props {
  onSelect: (note: NoteResult) => void;
  refreshTrigger: number;
  onNewNote: () => void;
}

export default function Sidebar(props: Props) {
  const [entries, setEntries] = createSignal<ListEntry[]>([]);
  const [currentPath, setCurrentPath] = createSignal<string | undefined>(undefined);
  const [pathStack, setPathStack] = createSignal<string[]>([]);
  const [showCreateDialog, setShowCreateDialog] = createSignal(false);
  const [newNotePath, setNewNotePath] = createSignal("");
  const [newNoteTitle, setNewNoteTitle] = createSignal("");

  async function loadEntries(prefix?: string) {
    try {
      const items = await notes.list(prefix);
      setEntries(items);
      setCurrentPath(prefix);
    } catch (err) {
      console.error("Failed to load entries:", err);
    }
  }

  createEffect(() => {
    // Reload when refreshTrigger changes
    const _ = props.refreshTrigger;
    loadEntries(currentPath());
  });

  // Initial load
  loadEntries();

  function navigateInto(path: string) {
    setPathStack([...pathStack(), currentPath() || ""]);
    loadEntries(path);
  }

  function navigateBack() {
    const stack = pathStack();
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1];
    setPathStack(stack.slice(0, -1));
    loadEntries(prev || undefined);
  }

  async function handleSelect(entry: ListEntry) {
    if (entry.type === "directory") {
      navigateInto(entry.path);
    } else {
      try {
        const note = await notes.get(entry.path);
        props.onSelect(note);
      } catch (err) {
        console.error("Failed to load note:", err);
      }
    }
  }

  async function handleCreate() {
    const path = newNotePath().trim();
    if (!path) return;
    try {
      const note = await notes.create(path, {
        title: newNoteTitle().trim() || undefined,
      });
      setShowCreateDialog(false);
      setNewNotePath("");
      setNewNoteTitle("");
      props.onNewNote();
      props.onSelect(note);
    } catch (err: any) {
      alert(err.message);
    }
  }

  return (
    <aside
      class="w-64 flex flex-col border-r overflow-hidden shrink-0"
      style={{
        "background-color": "var(--color-bg-secondary)",
        "border-color": "var(--color-border)",
      }}
    >
      {/* Header */}
      <div
        class="flex items-center justify-between px-4 py-3 border-b"
        style={{ "border-color": "var(--color-border)" }}
      >
        <h1 class="text-lg font-bold" style={{ color: "var(--color-accent)" }}>
          Knotes
        </h1>
        <button
          onClick={() => setShowCreateDialog(true)}
          class="w-7 h-7 flex items-center justify-center rounded text-lg cursor-pointer"
          style={{
            background: "var(--color-bg-surface)",
            color: "var(--color-text-secondary)",
          }}
          title="New note"
        >
          +
        </button>
      </div>

      {/* Breadcrumb / back */}
      <Show when={currentPath()}>
        <div
          class="flex items-center gap-2 px-4 py-2 text-sm border-b cursor-pointer"
          style={{ "border-color": "var(--color-border)", color: "var(--color-text-muted)" }}
          onClick={navigateBack}
        >
          <span>&#8592;</span>
          <span>{currentPath()}</span>
        </div>
      </Show>

      {/* File tree */}
      <div class="flex-1 overflow-y-auto py-2">
        <Show
          when={entries().length > 0}
          fallback={
            <p class="px-4 py-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
              No items
            </p>
          }
        >
          <For each={entries()}>
            {(entry) => (
              <div
                class="flex items-center gap-2 px-4 py-1.5 cursor-pointer transition-colors text-sm"
                style={{ color: "var(--color-text-secondary)" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = "var(--color-bg-hover)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "transparent")
                }
                onClick={() => handleSelect(entry)}
              >
                <span class="shrink-0">
                  {entry.type === "directory"
                    ? "\u{1F4C1}"
                    : entry.type === "log"
                      ? "\u{1F4CB}"
                      : "\u{1F4C4}"}
                </span>
                <span class="truncate">{entry.title}</span>
              </div>
            )}
          </For>
        </Show>
      </div>

      {/* Create dialog */}
      <Show when={showCreateDialog()}>
        <div
          class="p-4 border-t space-y-2"
          style={{ "border-color": "var(--color-border)", "background-color": "var(--color-bg-surface)" }}
        >
          <p class="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
            New Note
          </p>
          <input
            type="text"
            placeholder="Path (e.g. notes/ideas/foo)"
            value={newNotePath()}
            onInput={(e) => setNewNotePath(e.currentTarget.value)}
            class="w-full px-2 py-1 text-sm rounded border outline-none"
            style={{
              "background-color": "var(--color-bg-primary)",
              "border-color": "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
          <input
            type="text"
            placeholder="Title (optional)"
            value={newNoteTitle()}
            onInput={(e) => setNewNoteTitle(e.currentTarget.value)}
            class="w-full px-2 py-1 text-sm rounded border outline-none"
            style={{
              "background-color": "var(--color-bg-primary)",
              "border-color": "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
          <div class="flex gap-2">
            <button
              onClick={handleCreate}
              class="flex-1 px-2 py-1 text-sm rounded cursor-pointer"
              style={{ background: "var(--color-accent)", color: "#fff" }}
            >
              Create
            </button>
            <button
              onClick={() => setShowCreateDialog(false)}
              class="flex-1 px-2 py-1 text-sm rounded cursor-pointer"
              style={{ background: "var(--color-bg-hover)", color: "var(--color-text-secondary)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      </Show>
    </aside>
  );
}
