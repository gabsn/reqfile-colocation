import { expect, test } from "bun:test";
import { renderDigest, renderWelcome } from "./render";

test("welcome greets by name", () => {
  expect(renderWelcome("Ada").subject).toBe("Welcome, Ada");
});

test("digest counts items", () => {
  expect(renderDigest(["a", "b"]).subject).toBe("2 updates");
});
