export function toggleNthCheckbox(content: string, index: number): string {
  const lines = content.split("\n");
  let count = 0;
  let inFence = false;

  const result = lines.map((line) => {
    if (/^(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;

    const m = line.match(/^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]/);
    if (m && count++ === index) {
      const [, prefix, state] = m as [string, string, string];
      const newState = state.trim() === "" ? "x" : " ";
      return line.slice(0, prefix.length) + `[${newState}]` + line.slice(prefix.length + 3);
    }
    return line;
  });

  return result.join("\n");
}
