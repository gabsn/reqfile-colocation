import { expect, test } from "bun:test";
import { invoiceNumber } from "../invoice";

test("pads the sequence", () => {
  expect(invoiceNumber(2026, 42)).toBe("2026-00042");
});
