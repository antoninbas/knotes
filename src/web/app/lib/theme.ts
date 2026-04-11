import { createSignal } from "solid-js";

type Theme = "light" | "dark" | "system";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getStored(): Theme {
  return (localStorage.getItem("knotes-theme") as Theme) || "system";
}

const [theme, setThemeSignal] = createSignal<Theme>(getStored());

function applyTheme(t: Theme) {
  const resolved = t === "system" ? getSystemTheme() : t;
  document.documentElement.classList.toggle("light", resolved === "light");
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

// Apply on load
applyTheme(theme());

// Listen for system theme changes
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (theme() === "system") applyTheme("system");
  });

export function setTheme(t: Theme) {
  localStorage.setItem("knotes-theme", t);
  setThemeSignal(t);
  applyTheme(t);
}

export { theme };
