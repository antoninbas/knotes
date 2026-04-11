import { createSignal, createEffect, For, Show } from "solid-js";
import { notes, logs, type ListEntry, type NoteResult } from "../lib/api.ts";

interface Props {
  onSelect: (note: NoteResult) => void;
  refreshTrigger: number;
  onNewNote: () => void;
  currentPath: () => string | undefined;
}

type CreateMode = null | "note" | "folder" | "log";

export default function Sidebar(props: Props) {
  const [entries, setEntries] = createSignal<ListEntry[]>([]);
  const [browsePath, setBrowsePath] = createSignal<string | undefined>(undefined);
  const [pathStack, setPathStack] = createSignal<string[]>([]);
  const [createMode, setCreateMode] = createSignal<CreateMode>(null);
  const [inputName, setInputName] = createSignal("");
  const [inputTitle, setInputTitle] = createSignal("");

  async function loadEntries(prefix?: string) {
    try {
      const items = await notes.list(prefix);
      setEntries(items);
      setBrowsePath(prefix);
    } catch (err) {
      console.error("Failed to load entries:", err);
    }
  }

  createEffect(() => {
    const _ = props.refreshTrigger;
    loadEntries(browsePath());
  });

  loadEntries();

  function navigateInto(path: string) {
    setPathStack([...pathStack(), browsePath() || ""]);
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

  function openCreate(mode: CreateMode) {
    setCreateMode(mode);
    setInputName("");
    setInputTitle("");
  }

  async function handleCreate() {
    const name = inputName().trim();
    if (!name) return;

    const prefix = browsePath();
    const fullPath = prefix ? `${prefix}/${name}` : name;

    try {
      if (createMode() === "folder") {
        await notes.createFolder(fullPath);
        props.onNewNote();
        loadEntries(browsePath());
      } else if (createMode() === "log") {
        await logs.create(fullPath, inputTitle().trim() || undefined);
        props.onNewNote();
        const note = await notes.get(fullPath);
        props.onSelect(note);
      } else {
        const note = await notes.create(fullPath, {
          title: inputTitle().trim() || undefined,
        });
        props.onNewNote();
        props.onSelect(note);
      }
      setCreateMode(null);
    } catch (err: any) {
      alert(err.message);
    }
  }

  function handleCreateKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") setCreateMode(null);
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
        <div class="flex items-center gap-1">
          <button
            onClick={() => openCreate("folder")}
            class="w-7 h-7 flex items-center justify-center rounded text-sm cursor-pointer"
            style={{
              background: "var(--color-bg-surface)",
              color: "var(--color-text-secondary)",
            }}
            title="New folder"
          >
            {"\u{1F4C1}"}
          </button>
          <button
            onClick={() => openCreate("note")}
            class="w-7 h-7 flex items-center justify-center rounded text-sm cursor-pointer"
            style={{
              background: "var(--color-bg-surface)",
              color: "var(--color-text-secondary)",
            }}
            title="New note"
          >
            {"\u{1F4C4}"}
          </button>
          <button
            onClick={() => openCreate("log")}
            class="w-7 h-7 flex items-center justify-center rounded text-sm cursor-pointer"
            style={{
              background: "var(--color-bg-surface)",
              color: "var(--color-text-secondary)",
            }}
            title="New log"
          >
            {"\u{1F4CB}"}
          </button>
        </div>
      </div>

      {/* Breadcrumb / back */}
      <Show when={browsePath()}>
        <div
          class="flex items-center gap-2 px-4 py-2 text-sm border-b cursor-pointer"
          style={{ "border-color": "var(--color-border)", color: "var(--color-text-muted)" }}
          onClick={navigateBack}
        >
          <span>&#8592;</span>
          <span>{browsePath()}</span>
        </div>
      </Show>

      {/* Create inline form */}
      <Show when={createMode()}>
        <div
          class="px-4 py-3 border-b space-y-2"
          style={{ "border-color": "var(--color-border)", "background-color": "var(--color-bg-surface)" }}
        >
          <p class="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
            {createMode() === "folder"
              ? "New Folder"
              : createMode() === "log"
                ? "New Log"
                : "New Note"}
            {browsePath() ? ` in ${browsePath()}` : ""}
          </p>
          <input
            type="text"
            placeholder="Name"
            value={inputName()}
            onInput={(e) => setInputName(e.currentTarget.value)}
            onKeyDown={handleCreateKeyDown}
            autofocus
            class="w-full px-2 py-1 text-sm rounded border outline-none"
            style={{
              "background-color": "var(--color-bg-primary)",
              "border-color": "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
          <Show when={createMode() !== "folder"}>
            <input
              type="text"
              placeholder="Title (optional)"
              value={inputTitle()}
              onInput={(e) => setInputTitle(e.currentTarget.value)}
              onKeyDown={handleCreateKeyDown}
              class="w-full px-2 py-1 text-sm rounded border outline-none"
              style={{
                "background-color": "var(--color-bg-primary)",
                "border-color": "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </Show>
          <div class="flex gap-2">
            <button
              onClick={handleCreate}
              class="flex-1 px-2 py-1 text-sm rounded cursor-pointer"
              style={{ background: "var(--color-accent)", color: "#fff" }}
            >
              Create
            </button>
            <button
              onClick={() => setCreateMode(null)}
              class="flex-1 px-2 py-1 text-sm rounded cursor-pointer"
              style={{ background: "var(--color-bg-hover)", color: "var(--color-text-secondary)" }}
            >
              Cancel
            </button>
          </div>
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
            {(entry) => {
              const isActive = () => props.currentPath() === entry.path;
              return (
                <div
                  class="flex items-center gap-2 px-4 py-1.5 cursor-pointer transition-colors text-sm"
                  style={{
                    color: isActive() ? "var(--color-accent)" : "var(--color-text-secondary)",
                    "background-color": isActive() ? "var(--color-bg-surface)" : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive()) e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive()) e.currentTarget.style.backgroundColor = "transparent";
                  }}
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
              );
            }}
          </For>
        </Show>
      </div>
    </aside>
  );
}
