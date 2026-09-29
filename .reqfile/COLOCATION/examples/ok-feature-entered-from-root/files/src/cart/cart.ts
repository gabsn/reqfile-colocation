export type Line = { sku: string; quantity: number };

export function addToCart(lines: Line[], line: Line): Line[] {
  return [...lines, line];
}
