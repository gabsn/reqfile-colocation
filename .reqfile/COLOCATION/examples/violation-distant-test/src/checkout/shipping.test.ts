import { expect, test } from "vitest";
import { shippingCents } from "./shipping";

test("heavy parcels cost more", () => {
  expect(shippingCents(2500)).toBe(900);
});
