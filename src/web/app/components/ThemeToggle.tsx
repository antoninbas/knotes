import { theme, setTheme } from "../lib/theme.ts";

export default function ThemeToggle() {
  function cycle() {
    const current = theme();
    if (current === "dark") setTheme("light");
    else if (current === "light") setTheme("system");
    else setTheme("dark");
  }

  function icon() {
    const t = theme();
    if (t === "dark") return "\u{263E}"; // Moon
    if (t === "light") return "\u{2600}"; // Sun
    return "\u{1F5A5}"; // System
  }

  return (
    <button
      onClick={cycle}
      class="w-8 h-8 flex items-center justify-center rounded text-sm cursor-pointer"
      style={{
        background: "var(--color-bg-surface)",
        color: "var(--color-text-secondary)",
      }}
      title={`Theme: ${theme()}`}
    >
      {icon()}
    </button>
  );
}
