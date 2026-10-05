import { expect, test } from "bun:test";
import docs from "./fixtures/docs.json";
import { score } from "../src/search/rank";

test("a repeated term scores higher than a single match", () => {
  const [coffee, tea] = docs;
  expect(score(["coffee"], coffee.terms)).toBeGreaterThan(score(["coffee", "beans"], ["coffee"]));
  expect(score(["coffee"], tea.terms)).toBe(0);
});
