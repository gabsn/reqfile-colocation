export function applyDiscount(totalCents: number, percent: number): number {
  return Math.round(totalCents * (1 - percent / 100));
}
