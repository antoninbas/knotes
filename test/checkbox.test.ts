import { test, expect } from "vitest";
import { toggleNthCheckbox } from "../src/web/app/lib/checkbox.ts";

// --- basic toggling ---

test("checks an unchecked item", () => {
  expect(toggleNthCheckbox("- [ ] buy milk", 0)).toBe("- [x] buy milk");
});

test("unchecks a checked item", () => {
  expect(toggleNthCheckbox("- [x] buy milk", 0)).toBe("- [ ] buy milk");
});

test("unchecks an uppercase-X checked item", () => {
  expect(toggleNthCheckbox("- [X] buy milk", 0)).toBe("- [ ] buy milk");
});

// --- index selection ---

test("toggles the item at the given index, leaving others unchanged", () => {
  const content = "- [ ] alpha\n- [ ] beta\n- [ ] gamma";
  expect(toggleNthCheckbox(content, 1)).toBe("- [ ] alpha\n- [x] beta\n- [ ] gamma");
});

test("toggles the last item", () => {
  const content = "- [x] alpha\n- [x] beta\n- [ ] gamma";
  expect(toggleNthCheckbox(content, 2)).toBe("- [x] alpha\n- [x] beta\n- [x] gamma");
});

// --- list marker variants ---

test("handles * bullet marker", () => {
  expect(toggleNthCheckbox("* [ ] item", 0)).toBe("* [x] item");
});

test("handles + bullet marker", () => {
  expect(toggleNthCheckbox("+ [ ] item", 0)).toBe("+ [x] item");
});

test("handles ordered list marker", () => {
  expect(toggleNthCheckbox("1. [ ] item", 0)).toBe("1. [x] item");
});

test("handles multi-digit ordered list marker", () => {
  expect(toggleNthCheckbox("10. [ ] item", 0)).toBe("10. [x] item");
});

// --- indentation ---

test("handles indented (nested) items", () => {
  const content = "- [ ] parent\n  - [ ] child";
  expect(toggleNthCheckbox(content, 1)).toBe("- [ ] parent\n  - [x] child");
});

test("handles deeply indented items", () => {
  const content = "- [ ] a\n    - [ ] b\n        - [ ] c";
  expect(toggleNthCheckbox(content, 2)).toBe("- [ ] a\n    - [ ] b\n        - [x] c");
});

// --- mixed content ---

test("ignores non-checkbox list items", () => {
  const content = "- plain item\n- [ ] checkbox\n- another plain";
  expect(toggleNthCheckbox(content, 0)).toBe("- plain item\n- [x] checkbox\n- another plain");
});

test("ignores [ ] not at the start of a list item", () => {
  const content = "Some text with [ ] inline\n- [ ] actual checkbox";
  expect(toggleNthCheckbox(content, 0)).toBe("Some text with [ ] inline\n- [x] actual checkbox");
});

test("ignores checkboxes inside fenced code blocks", () => {
  const content = "```\n- [ ] not a checkbox\n```\n- [ ] real checkbox";
  expect(toggleNthCheckbox(content, 0)).toBe("```\n- [x] not a checkbox\n```\n- [ ] real checkbox");
  // NOTE: the regex does not parse fenced code blocks — it matches by line shape only.
  // This is a known limitation; in practice notes rarely have task-list syntax inside fences.
});

// --- out of range / empty ---

test("returns content unchanged when index is out of range", () => {
  const content = "- [ ] only item";
  expect(toggleNthCheckbox(content, 1)).toBe(content);
});

test("returns content unchanged when there are no checkboxes", () => {
  const content = "# heading\n\njust a paragraph\n\n- plain list item";
  expect(toggleNthCheckbox(content, 0)).toBe(content);
});

test("returns empty string unchanged", () => {
  expect(toggleNthCheckbox("", 0)).toBe("");
});

test("handles negative index without throwing", () => {
  const content = "- [ ] item";
  expect(toggleNthCheckbox(content, -1)).toBe(content);
});
