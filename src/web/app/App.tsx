import { createSignal, Show } from "solid-js";
import Sidebar from "./components/Sidebar.tsx";
import NoteView from "./components/NoteView.tsx";
import Editor from "./components/Editor.tsx";
import LogView from "./components/LogView.tsx";
import SearchView from "./components/SearchView.tsx";
import ThemeToggle from "./components/ThemeToggle.tsx";
import DropdownMenu from "./components/DropdownMenu.tsx";
import JobsList from "./components/JobsList.tsx";
import { notes, searchApi, versionApi, type NoteResult } from "./lib/api.ts";

export type ViewMode = "view" | "edit";

export default function App() {
  const [currentNote, setCurrentNote] = createSignal<NoteResult | null>(null);
  const [viewMode, setViewMode] = createSignal<ViewMode>("view");
  const [showSearch, setShowSearch] = createSignal(false);
  const [sidebarRefresh, setSidebarRefresh] = createSignal(0);
  const [readOnly, setReadOnly] = createSignal(false);
  const [embedding, setEmbedding] = createSignal(false);
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [showAbout, setShowAbout] = createSignal(false);
  const [showJobs, setShowJobs] = createSignal(false);
  const [version, setVersion] = createSignal<string | null>(null);

  function handleNoteSelect(note: NoteResult) {
    setCurrentNote(note);
    setViewMode("view");
    setShowSearch(false);
    setSidebarOpen(false);
  }

  function handleNoteSelectEdit(note: NoteResult) {
    setCurrentNote(note);
    setViewMode("edit");
    setShowSearch(false);
    setSidebarOpen(false);
  }

  function handleNoteSaved() {
    setSidebarRefresh((n) => n + 1);
  }

  function handleHome() {
    setCurrentNote(null);
    setViewMode("view");
    setShowSearch(false);
    setSidebarOpen(false);
    setShowAbout(false);
    setShowJobs(false);
  }

  function handleDeleteActive(path: string) {
    if (currentNote()?.path === path) {
      setCurrentNote(null);
      setViewMode("view");
    }
    setSidebarRefresh((n) => n + 1);
  }

  async function handleRename(oldPath: string, newPath: string) {
    if (currentNote()?.path === oldPath) {
      try {
        const updated = await notes.get(newPath);
        setCurrentNote(updated);
      } catch {
        setCurrentNote(null);
        setViewMode("view");
      }
    } else if (currentNote()?.path.startsWith(oldPath + "/")) {
      const rebased = newPath + currentNote()!.path.slice(oldPath.length);
      try {
        const updated = await notes.get(rebased);
        setCurrentNote(updated);
      } catch {
        setCurrentNote(null);
        setViewMode("view");
      }
    }
    setSidebarRefresh((n) => n + 1);
  }

  async function handleUpdateJournal() {
    // Reload current note to pick up updated frontmatter (description etc.)
    const path = currentNote()?.path;
    if (!path) return;
    try {
      const updated = await notes.get(path);
      setCurrentNote(updated);
    } catch (err) {
      console.error("Failed to reload note after journal update:", err);
    }
  }

  async function triggerEmbed() {
    setEmbedding(true);
    try {
      await searchApi.embed();
    } catch (err) {
      console.error("Embed failed:", err);
    } finally {
      setEmbedding(false);
    }
  }

  async function openAbout() {
    if (!version()) {
      try {
        setVersion(await versionApi.get());
      } catch (err) {
        console.error("Failed to fetch version:", err);
      }
    }
    setShowAbout(true);
  }

  const currentPath = () => currentNote()?.path;
  const isLog = () => currentNote()?.type === "log";

  // Keyboard shortcut: Ctrl+K for search
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      setShowSearch((v) => !v);
    }
    if (e.key === "Escape") {
      if (showSearch()) {
        setShowSearch(false);
      } else {
        setSidebarOpen(false);
      }
    }
  });

  return (
    <div class="flex h-screen overflow-hidden">
      {/* Sidebar - always visible on desktop, overlay on mobile */}
      <div
        class="hidden md:block shrink-0"
      >
        <Sidebar
          onSelect={handleNoteSelect}
          onSelectEdit={handleNoteSelectEdit}
          refreshTrigger={sidebarRefresh()}
          onNewNote={handleNoteSaved}
          currentPath={currentPath}
          readOnly={readOnly()}
          onDeleteActive={handleDeleteActive}
          onRename={handleRename}
          onHome={handleHome}
        />
      </div>

      {/* Mobile sidebar overlay */}
      <Show when={sidebarOpen()}>
        <div
          class="fixed inset-0 z-40 flex md:hidden"
        >
          <div class="shrink-0">
            <Sidebar
              onSelect={handleNoteSelect}
              onSelectEdit={handleNoteSelectEdit}
              refreshTrigger={sidebarRefresh()}
              onNewNote={handleNoteSaved}
              currentPath={currentPath}
              readOnly={readOnly()}
              onDeleteActive={handleDeleteActive}
            />
          </div>
          <div
            class="flex-1"
            style={{ background: "rgba(0,0,0,0.4)" }}
            onClick={() => setSidebarOpen(false)}
          />
        </div>
      </Show>

      {/* Main content */}
      <div class="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Toolbar */}
        <header
          class="flex items-center justify-between px-2 sm:px-4 py-2 border-b gap-2"
          style={{ "border-color": "var(--color-border)", "background-color": "var(--color-bg-secondary)" }}
        >
          <div class="flex items-center gap-2 min-w-0">
            {/* Mobile menu button */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen())}
              class="md:hidden px-2 py-1 text-sm rounded cursor-pointer shrink-0"
              style={{
                background: "var(--color-bg-surface)",
                color: "var(--color-text-secondary)",
              }}
              title="Toggle sidebar"
            >
              &#9776;
            </button>
            <Show when={currentNote()}>
              <h2 class="text-base sm:text-lg font-medium truncate" style={{ color: "var(--color-text-primary)" }}>
                {currentNote()!.title}
              </h2>
              <span class="text-xs px-2 py-0.5 rounded hidden sm:inline-block shrink-0" style={{ background: "var(--color-bg-surface)", color: "var(--color-text-muted)" }}>
                {currentNote()!.path}
              </span>
              <Show when={isLog()}>
                <span class="text-xs px-2 py-0.5 rounded shrink-0" style={{ background: "var(--color-bg-surface)", color: "var(--color-accent)" }}>
                  log
                </span>
              </Show>
            </Show>
            <Show when={readOnly()}>
              <span class="text-xs px-2 py-0.5 rounded shrink-0" style={{ background: "var(--color-danger)", color: "#fff" }}>
                read-only
              </span>
            </Show>
          </div>
          <div class="flex items-center gap-1 sm:gap-2 shrink-0">
            {/* Only show Edit button for notes, not logs, not in read-only mode, not in search */}
            <Show when={!showSearch() && currentNote() && !isLog() && !readOnly()}>
              <button
                onClick={() => setViewMode(viewMode() === "view" ? "edit" : "view")}
                class="px-2 sm:px-3 py-1 text-sm rounded transition-colors cursor-pointer"
                style={{
                  background: "var(--color-bg-surface)",
                  color: "var(--color-text-secondary)",
                }}
              >
                {viewMode() === "view" ? "Edit" : "View"}
              </button>
            </Show>
            <Show when={!showSearch() && currentNote()}>
              <a
                href={`/api/notes/download?path=${encodeURIComponent(currentNote()!.path)}`}
                download=""
                class="px-2 sm:px-3 py-1 text-sm rounded transition-colors cursor-pointer hidden sm:inline-block"
                style={{
                  background: "var(--color-bg-surface)",
                  color: "var(--color-text-secondary)",
                  "text-decoration": "none",
                }}
                title="Download as Markdown"
              >
                Download
              </a>
            </Show>
            <button
              onClick={() => setShowSearch((v) => !v)}
              class="px-2 sm:px-3 py-1 text-sm rounded transition-colors cursor-pointer"
              style={{
                background: showSearch() ? "var(--color-accent)" : "var(--color-bg-surface)",
                color: showSearch() ? "#fff" : "var(--color-text-secondary)",
              }}
              title="Search (Ctrl+K)"
            >
              Search
            </button>
            <button
              onClick={() => {
                setReadOnly(!readOnly());
                if (readOnly()) setViewMode("view");
              }}
              class="px-2 sm:px-3 py-1 text-sm rounded transition-colors cursor-pointer"
              style={{
                background: readOnly() ? "var(--color-danger)" : "var(--color-bg-surface)",
                color: readOnly() ? "#fff" : "var(--color-text-muted)",
              }}
              title={readOnly() ? "Disable read-only mode" : "Enable read-only mode"}
            >
              {readOnly() ? "RO" : "RW"}
            </button>
            <ThemeToggle />
            <DropdownMenu
              items={[
                { label: embedding() ? "Embedding..." : "Run Embed Job", onClick: triggerEmbed, disabled: embedding() },
                { label: "View Embed Jobs", onClick: () => setShowJobs(true) },
                { label: "About", onClick: openAbout },
              ]}
            />
          </div>
        </header>

        {/* Content area */}
        <main class="flex-1 overflow-hidden" style={{ "background-color": "var(--color-bg-primary)" }}>
          <Show when={showSearch()}>
            <SearchView onSelect={handleNoteSelect} />
          </Show>
          <Show when={!showSearch()}>
            <div class="h-full overflow-auto p-3 sm:p-6">
              <Show
                when={currentNote()}
                fallback={
                  <div class="flex items-center justify-center h-full">
                    <div class="text-center px-4" style={{ color: "var(--color-text-muted)" }}>
                      <p class="text-xl mb-2">Welcome to Knotes</p>
                      <p class="text-sm">
                        <span class="hidden sm:inline">Select a note from the sidebar or press Ctrl+K to search</span>
                        <span class="sm:hidden">Tap &#9776; to browse or Search to find notes</span>
                      </p>
                    </div>
                  </div>
                }
              >
                <Show
                  when={isLog()}
                  fallback={
                    <Show
                      when={viewMode() === "edit" && !readOnly()}
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
                  <LogView note={currentNote()!} readOnly={readOnly()} onUpdateJournal={handleUpdateJournal} />
                </Show>
              </Show>
            </div>
          </Show>
        </main>
      </div>

      {/* Jobs modal */}
      <Show when={showJobs()}>
        <JobsList onClose={() => setShowJobs(false)} />
      </Show>

      {/* About modal */}
      <Show when={showAbout()}>
        <div
          class="fixed inset-0 flex items-center justify-center z-50 px-4"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowAbout(false)}
        >
          <div
            class="rounded-lg shadow-xl p-6 max-w-sm w-full"
            style={{ background: "var(--color-bg-secondary)", color: "var(--color-text-primary)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 class="text-xl font-bold mb-4">Knotes</h2>
            <div class="space-y-2 text-sm" style={{ color: "var(--color-text-secondary)" }}>
              <p>
                <span style={{ color: "var(--color-text-muted)" }}>Version</span>{" "}
                <code
                  class="px-1.5 py-0.5 rounded text-xs"
                  style={{ background: "var(--color-bg-surface)" }}
                >
                  {version() ?? "..."}
                </code>
              </p>
              <p>
                <span style={{ color: "var(--color-text-muted)" }}>Author</span>{" "}
                Antonin Bas
              </p>
              <p>
                <a
                  href="https://github.com/antoninbas/knotes"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--color-accent)" }}
                >
                  GitHub
                </a>
              </p>
            </div>
            <button
              onClick={() => setShowAbout(false)}
              class="mt-4 px-4 py-1.5 text-sm rounded cursor-pointer w-full"
              style={{ background: "var(--color-bg-surface)", color: "var(--color-text-secondary)" }}
            >
              Close
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
