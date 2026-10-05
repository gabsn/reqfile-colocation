import { expect, test } from "bun:test";
import { wrap } from "./wrap";

test("wraps on spaces", () => {
  expect(wrap("aa bb cc", 5)).toEqual(["aa bb", "cc"]);
});

test("cuts long words", () => {
  expect(wrap("abcdefg", 3)).toEqual(["abc", "def", "g"]);
});
