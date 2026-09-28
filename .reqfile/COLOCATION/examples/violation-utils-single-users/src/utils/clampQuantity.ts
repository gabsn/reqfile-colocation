export function clampQuantity(quantity: number): number {
  return Math.min(99, Math.max(1, Math.floor(quantity)));
}
