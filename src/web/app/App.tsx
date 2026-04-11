import { createSignal, Show } from "solid-js";
import Sidebar from "./components/Sidebar.tsx";
import NoteView from "./components/NoteView.tsx";
import Editor from "./components/Editor.tsx";
import LogView from "./components/LogView.tsx";
import SearchBar from "./components/SearchBar.tsx";
import ThemeToggle from "./components/ThemeToggle.tsx";
import type { NoteResult } from "./lib/api.ts";

export type ViewMode = "view" | "edit";

export default function App() {
  const [currentNote, setCurrentNote] = createSignal<NoteResult | null>(null);
  const [viewMode, setViewMode] = createSignal<ViewMode>("view");
  const [showSearch, setShowSearch] = createSignal(false);
  const [sidebarRefresh, setSidebarRefresh] = createSignal(0);

  function handleNoteSelect(note: NoteResult) {
    setCurrentNote(note);
    setViewMode("view");
  }

  function handleNoteSaved() {
    setSidebarRefresh((n) => n + 1);
  }

  // Keyboard shortcut: Ctrl+K for search
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      setShowSearch((v) => !v);
    }
    if (e.key === "Escape") {
      setShowSearch(false);
    }
  });

  return (
    <div class="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        onSelect={handleNoteSelect}
        refreshTrigger={sidebarRefresh()}
        onNewNote={handleNoteSaved}
      />

      {/* Main content */}
      <div class="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <header
          class="flex items-center justify-between px-4 py-2 border-b"
          style={{ "border-color": "var(--color-border)", "background-color": "var(--color-bg-secondary)" }}
        >
          <div class="flex items-center gap-3">
            <Show when={currentNote()}>
              <h2 class="text-lg font-medium" style={{ color: "var(--color-text-primary)" }}>
                {currentNote()!.title}
              </h2>
              <span class="text-xs px-2 py-0.5 rounded" style={{ background: "var(--color-bg-surface)", color: "var(--color-text-muted)" }}>
                {currentNote()!.path}
              </span>
            </Show>
          </div>
          <div class="flex items-center gap-2">
            <Show when={currentNote()}>
              <button
                onClick={() => setViewMode(viewMode() === "view" ? "edit" : "view")}
                class="px-3 py-1 text-sm rounded transition-colors cursor-pointer"
                style={{
                  background: "var(--color-bg-surface)",
                  color: "var(--color-text-secondary)",
                }}
              >
                {viewMode() === "view" ? "Edit" : "View"}
              </button>
            </Show>
            <button
              onClick={() => setShowSearch(true)}
              class="px-3 py-1 text-sm rounded transition-colors cursor-pointer"
              style={{
                background: "var(--color-bg-surface)",
                color: "var(--color-text-secondary)",
              }}
              title="Search (Ctrl+K)"
            >
              Search
            </button>
            <ThemeToggle />
          </div>
        </header>

        {/* Content area */}
        <main class="flex-1 overflow-auto p-6" style={{ "background-color": "var(--color-bg-primary)" }}>
          <Show
            when={currentNote()}
            fallback={
              <div class="flex items-center justify-center h-full">
                <div class="text-center" style={{ color: "var(--color-text-muted)" }}>
                  <p class="text-xl mb-2">Welcome to Knotes</p>
                  <p class="text-sm">Select a note from the sidebar or press Ctrl+K to search</p>
                </div>
              </div>
            }
          >
            <Show
              when={currentNote()!.type === "log"}
              fallback={
                <Show
                  when={viewMode() === "edit"}
                  fallback={<NoteView note={currentNote()!} />}
                >
                  <Editor
                    note={currentNote()!}
                    onSave={(updated) => {
                      setCurrentNote(updated);
                      setViewMode("view");
                      handleNoteSaved();
                    }}
                  />
                </Show>
              }
            >
              <LogView note={currentNote()!} />
            </Show>
          </Show>
        </main>
      </div>

      {/* Search modal */}
      <Show when={showSearch()}>
        <SearchBar
          onClose={() => setShowSearch(false)}
          onSelect={(note) => {
            handleNoteSelect(note);
            setShowSearch(false);
          }}
        />
      </Show>
    </div>
  );
}
