import { createSignal, createEffect, For, Show, onCleanup } from "solid-js";
import { notes, logs, contextApi, type ListEntry, type NoteResult } from "../lib/api.ts";

interface Props {
  onSelect: (note: NoteResult) => void;
  onSelectEdit?: (note: NoteResult) => void;
  refreshTrigger: number;
  onNewNote: () => void;
  currentPath: () => string | undefined;
  readOnly: boolean;
  onDeleteActive?: (path: string) => void;
}

type CreateMode = null | "note" | "folder" | "log";

interface ContextMenu {
  x: number;
  y: number;
  entry: ListEntry;
}

export default function Sidebar(props: Props) {
  const [entries, setEntries] = createSignal<ListEntry[]>([]);
  const [browsePath, setBrowsePath] = createSignal<string | undefined>(undefined);
  const [pathStack, setPathStack] = createSignal<string[]>([]);
  const [createMode, setCreateMode] = createSignal<CreateMode>(null);
  const [inputName, setInputName] = createSignal("");
  const [inputTitle, setInputTitle] = createSignal("");
  const [createError, setCreateError] = createSignal<string | null>(null);
  const [contextMenu, setContextMenu] = createSignal<ContextMenu | null>(null);

  // Folder context state
  const [folderContext, setFolderContext] = createSignal<string>("");
  const [editingContext, setEditingContext] = createSignal(false);
  const [contextInput, setContextInput] = createSignal("");
  const [contextLoading, setContextLoading] = createSignal(false);

  async function loadEntries(prefix?: string) {
    try {
      const items = await notes.list(prefix);
      setEntries(items);
      setBrowsePath(prefix);
    } catch (err) {
      console.error("Failed to load entries:", err);
    }
  }

  async function loadFolderContext(path: string) {
    try {
      const res = await contextApi.get(path);
      setFolderContext(res.context ?? "");
    } catch {
      setFolderContext("");
    }
  }

  createEffect(() => {
    const _ = props.refreshTrigger;
    loadEntries(browsePath());
  });

  createEffect(() => {
    const path = browsePath();
    if (path) {
      loadFolderContext(path);
    } else {
      setFolderContext("");
      setEditingContext(false);
    }
  });

  loadEntries();

  // Dismiss context menu on outside click
  function handleDocumentClick() {
    setContextMenu(null);
  }
  document.addEventListener("click", handleDocumentClick);
  onCleanup(() => document.removeEventListener("click", handleDocumentClick));

  function navigateInto(path: string) {
    setPathStack([...pathStack(), browsePath() || ""]);
    setEditingContext(false);
    loadEntries(path);
  }

  function navigateBack() {
    const stack = pathStack();
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1];
    setPathStack(stack.slice(0, -1));
    setEditingContext(false);
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
    setCreateError(null);
  }

  async function handleCreate() {
    const name = inputName().trim();
    if (!name) return;

    setCreateError(null);
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
      setCreateError(err.message || "Failed to create. Please try again.");
    }
  }

  function handleCreateKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") setCreateMode(null);
  }

  function handleContextMenu(e: MouseEvent, entry: ListEntry) {
    if (props.readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }

  async function handleDelete(entry: ListEntry) {
    setContextMenu(null);
    const label = entry.type === "directory" ? "folder and all its contents" : entry.type === "log" ? "journal" : "note";
    if (!confirm(`Delete this ${label}? This cannot be undone.`)) return;
    try {
      if (entry.type === "directory") {
        await notes.deleteFolder(entry.path);
      } else if (entry.type === "log") {
        await logs.deleteJournal(entry.path);
      } else {
        await notes.delete(entry.path);
      }
      props.onDeleteActive?.(entry.path);
      loadEntries(browsePath());
    } catch (err: any) {
      alert(`Failed to delete: ${err.message}`);
    }
  }

  function startEditContext() {
    setContextInput(folderContext());
    setEditingContext(true);
  }

  async function saveContext() {
    const path = browsePath();
    if (!path) return;
    setContextLoading(true);
    try {
      const text = contextInput().trim();
      if (text) {
        await contextApi.set(path, text);
        setFolderContext(text);
      } else {
        await contextApi.remove(path);
        setFolderContext("");
      }
      setEditingContext(false);
    } catch (err: any) {
      console.error("Failed to save context:", err);
    } finally {
      setContextLoading(false);
    }
  }

  function cancelEditContext() {
    setEditingContext(false);
    setContextInput("");
  }

  // Determine which zone we're in based on browsePath
  const zone = (): "root" | "notes" | "logs" => {
    const p = browsePath();
    if (!p) return "root";
    if (p === "notes" || p.startsWith("notes/")) return "notes";
    if (p === "logs" || p.startsWith("logs/")) return "logs";
    return "root";
  };

  const canCreateFolder = () => !props.readOnly && zone() !== "root";
  const canCreateNote = () => !props.readOnly && zone() === "notes";
  const canCreateLog = () => !props.readOnly && zone() === "logs";

  return (
    <aside
      class="w-64 h-screen flex flex-col border-r overflow-hidden shrink-0"
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
          <Show when={canCreateFolder()}>
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
          </Show>
          <Show when={canCreateNote()}>
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
          </Show>
          <Show when={canCreateLog()}>
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
          </Show>
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

      {/* Folder context panel */}
      <Show when={browsePath() && !editingContext()}>
        <div
          class="px-4 py-2 border-b"
          style={{ "border-color": "var(--color-border)" }}
        >
          <div
            class="flex items-start gap-1 cursor-pointer group"
            onClick={() => !props.readOnly && startEditContext()}
            title={props.readOnly ? undefined : "Click to edit folder context"}
          >
            <Show when={!props.readOnly}>
              <span
                class="text-xs mt-0.5 shrink-0 opacity-40 group-hover:opacity-70"
                style={{ color: "var(--color-text-muted)" }}
              >
                ✎
              </span>
            </Show>
            <span
              class="text-xs italic leading-snug"
              style={{ color: folderContext() ? "var(--color-text-muted)" : "var(--color-text-muted)", opacity: folderContext() ? 0.8 : 0.4 }}
            >
              {folderContext() || (props.readOnly ? "" : "Add context for this folder...")}
            </span>
          </div>
        </div>
      </Show>
      <Show when={browsePath() && editingContext()}>
        <div
          class="px-3 py-2 border-b space-y-2"
          style={{ "border-color": "var(--color-border)", "background-color": "var(--color-bg-surface)" }}
        >
          <textarea
            rows={3}
            placeholder="Describe what this folder contains..."
            value={contextInput()}
            onInput={(e) => setContextInput(e.currentTarget.value)}
            class="w-full px-2 py-1 text-xs rounded border outline-none resize-none"
            style={{
              "background-color": "var(--color-bg-primary)",
              "border-color": "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
            // eslint-disable-next-line solid/reactivity
            ref={(el) => setTimeout(() => el?.focus(), 0)}
          />
          <div class="flex gap-2">
            <button
              onClick={saveContext}
              disabled={contextLoading()}
              class="flex-1 px-2 py-1 text-xs rounded cursor-pointer"
              style={{ background: "var(--color-accent)", color: "#fff" }}
            >
              Save
            </button>
            <button
              onClick={cancelEditContext}
              class="flex-1 px-2 py-1 text-xs rounded cursor-pointer"
              style={{ background: "var(--color-bg-hover)", color: "var(--color-text-secondary)" }}
            >
              Cancel
            </button>
          </div>
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
          <Show when={createError()}>
            <p class="text-xs text-red-500">{createError()}</p>
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
                  onContextMenu={(e) => handleContextMenu(e, entry)}
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

      {/* Right-click context menu */}
      <Show when={contextMenu()}>
        {(menu) => {
          const entry = () => menu().entry;
          const isTopLevel = () => entry().path === "notes" || entry().path === "logs";
          const isDirectory = () => entry().type === "directory";
          const isNote = () => entry().type === "note";
          return (
            <div
              class="fixed z-50 rounded shadow-lg border py-1 text-sm"
              style={{
                left: `${menu().x}px`,
                top: `${menu().y}px`,
                "background-color": "var(--color-bg-surface)",
                "border-color": "var(--color-border)",
                "min-width": "120px",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Open — always shown */}
              <button
                class="w-full text-left px-3 py-1.5 cursor-pointer"
                style={{ color: "var(--color-text-primary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                onClick={async () => {
                  const { path, type } = entry();
                  setContextMenu(null);
                  if (type === "directory") {
                    navigateInto(path);
                  } else {
                    const note = await notes.get(path);
                    props.onSelect(note);
                  }
                }}
              >
                Open
              </button>
              {/* Edit — notes only (not logs, not directories) */}
              <Show when={isNote() && !props.readOnly}>
                <button
                  class="w-full text-left px-3 py-1.5 cursor-pointer"
                  style={{ color: "var(--color-text-primary)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                  onClick={async () => {
                    const path = entry().path;
                    setContextMenu(null);
                    const note = await notes.get(path);
                    props.onSelectEdit?.(note);
                  }}
                >
                  Edit
                </button>
              </Show>
              {/* Delete — non-top-level entries only */}
              <Show when={!isTopLevel() && !props.readOnly}>
                <button
                  class="w-full text-left px-3 py-1.5 cursor-pointer"
                  style={{ color: "#ef4444" }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                  onClick={() => handleDelete(entry())}
                >
                  Delete
                </button>
              </Show>
            </div>
          );
        }}
      </Show>
    </aside>
  );
}
