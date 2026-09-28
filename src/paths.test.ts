import { expect, test } from "bun:test";
import { commonFolder, normalize } from "./paths";

test("commonFolder stops at the first difference", () => {
  expect(commonFolder(["src/billing", "src/cart"])).toBe("src");
  expect(commonFolder(["src/billing"])).toBe("src/billing");
  expect(commonFolder(["src", "test/unit"])).toBe("");
});

test("normalize resolves parent segments", () => {
  expect(normalize("test/unit/../../src/a.ts")).toBe("src/a.ts");
  expect(normalize("../a.ts")).toBeNull();
});
