export function toggleNthCheckbox(content: string, index: number): string {
  let count = 0;
  return content.replace(/^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]/gm, (match, prefix, state) => {
    if (count++ === index) {
      return `${prefix}[${state.trim() === "" ? "x" : " "}]`;
    }
    return match;
  });
}
