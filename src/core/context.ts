import { getAllContexts, getContextValue, setContextValue, removeContextValue, type ContextEntry } from "./db.ts";
import { resetStore } from "./search.ts";

export type { ContextEntry };

export function listContexts(): ContextEntry[] {
  return getAllContexts();
}

export function getContext(path: string): string | undefined {
  return getContextValue(path) ?? undefined;
}

export function setContext(path: string, context: string): void {
  setContextValue(path, context);
  resetStore();
}

export function removeContext(path: string): void {
  removeContextValue(path);
  resetStore();
}
