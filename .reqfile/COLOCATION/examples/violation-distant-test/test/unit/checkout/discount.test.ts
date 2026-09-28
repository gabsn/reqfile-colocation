import { expect, test } from "vitest";
import { applyDiscount } from "../../../src/checkout/discount";

test("ten percent off", () => {
  expect(applyDiscount(1000, 10)).toBe(900);
});
