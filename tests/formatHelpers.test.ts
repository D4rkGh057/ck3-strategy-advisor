import { expect, test } from "vitest";
import { block, bullet } from "../src/format.js";

test("bullet prefixes an entry and adds no trailing newline", () => {
  expect(bullet("a")).toBe("- a");
});

test("block stacks entries one per line and closes the last one", () => {
  expect(block(["- a", "- b"])).toBe("- a\n- b\n");
  expect(block(["- a"])).toBe("- a\n");
});

test("block of nothing is empty, so an empty list adds no blank line", () => {
  expect(block([])).toBe("");
});

test("block keeps multi-line entries intact", () => {
  expect(block(["- a\n  detail", "- b"])).toBe("- a\n  detail\n- b\n");
});
