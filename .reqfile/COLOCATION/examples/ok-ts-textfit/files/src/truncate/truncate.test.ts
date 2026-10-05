import { expect, test } from "bun:test";
import { truncate } from "./truncate";

test("keeps short text", () => {
  expect(truncate("hi", 5)).toBe("hi");
});

test("ends cut text with an ellipsis", () => {
  expect(truncate("hello world", 6)).toBe("hello\u2026");
});
