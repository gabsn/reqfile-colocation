import { clampQuantity } from "../utils/clampQuantity";

export type Line = { sku: string; quantity: number };

export function addLine(lines: Line[], sku: string, quantity: number): Line[] {
  return [...lines, { sku, quantity: clampQuantity(quantity) }];
}
