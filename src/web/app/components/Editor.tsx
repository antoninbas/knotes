import { createSignal, onMount, onCleanup, createEffect } from "solid-js";
import { notes, type NoteResult } from "../lib/api.ts";
import { EditorView, keymap, placeholder, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { theme } from "../lib/theme.ts";

interface Props {
  note: NoteResult;
  onSave: (updated: NoteResult) => void;
}

function createEditorTheme(isDark: boolean) {
  return EditorView.theme({
    "&": {
      backgroundColor: isDark ? "#313244" : "#ccd0da",
      color: isDark ? "#cdd6f4" : "#4c4f69",
      borderRadius: "6px",
      border: `1px solid ${isDark ? "#45475a" : "#bcc0cc"}`,
      fontSize: "14px",
    },
    ".cm-content": {
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      padding: "12px 0",
      caretColor: isDark ? "#89b4fa" : "#1e66f5",
    },
    ".cm-cursor": {
      borderLeftColor: isDark ? "#89b4fa" : "#1e66f5",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: isDark ? "#45475a" : "#bcc0cc",
    },
    ".cm-activeLine": {
      backgroundColor: isDark ? "rgba(69, 71, 90, 0.4)" : "rgba(188, 192, 204, 0.4)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: isDark ? "rgba(69, 71, 90, 0.4)" : "rgba(188, 192, 204, 0.4)",
    },
    ".cm-gutters": {
      backgroundColor: isDark ? "#1e1e2e" : "#e6e9ef",
      color: isDark ? "#6c7086" : "#8c8fa1",
      border: "none",
      borderRight: `1px solid ${isDark ? "#45475a" : "#bcc0cc"}`,
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 8px",
    },
    ".cm-scroller": {
      overflow: "auto",
    },
  }, { dark: isDark });
}

export default function Editor(props: Props) {
  let containerRef: HTMLDivElement | undefined;
  let editorView: EditorView | undefined;
  const [title, setTitle] = createSignal(props.note.title);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Track content via closure so save always gets the latest
  let currentContent = props.note.content;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updated = await notes.update(props.note.path, {
        title: title(),
        content: currentContent,
      });
      props.onSave(updated);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  onMount(() => {
    if (!containerRef) return;

    const isDark = theme() !== "light";

    const saveKeymap = keymap.of([{
      key: "Mod-s",
      run: () => { handleSave(); return true; },
    }]);

    const state = EditorState.create({
      doc: props.note.content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        createEditorTheme(isDark),
        saveKeymap,
        keymap.of([
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...closeBracketsKeymap,
        ]),
        placeholder("Write your note in markdown..."),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            currentContent = update.state.doc.toString();
          }
        }),
        EditorView.lineWrapping,
      ],
    });

    editorView = new EditorView({
      state,
      parent: containerRef,
    });

    // Focus the editor
    editorView.focus();
  });

  onCleanup(() => {
    editorView?.destroy();
  });

  // Rebuild editor when theme changes
  createEffect(() => {
    const t = theme();
    if (editorView) {
      const isDark = t !== "light";
      editorView.dispatch({
        effects: EditorView.reconfigure.of([]),
      });
      // Full reconfigure is complex; for now the theme at mount time is used.
      // A full theme switch would require compartments — acceptable trade-off.
    }
  });

  return (
    <div class="max-w-4xl mx-auto space-y-4">
      <input
        type="text"
        value={title()}
        onInput={(e) => setTitle(e.currentTarget.value)}
        class="w-full text-2xl font-bold bg-transparent border-none outline-none"
        style={{ color: "var(--color-text-primary)" }}
        placeholder="Note title"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            handleSave();
          }
        }}
      />
      <div
        ref={containerRef}
        class="min-h-[60vh] rounded overflow-hidden"
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
