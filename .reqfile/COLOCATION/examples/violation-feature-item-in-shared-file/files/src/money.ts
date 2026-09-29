export function formatMoney(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

export function invoiceTotal(lines: { cents: number }[]): number {
  return lines.reduce((sum, line) => sum + line.cents, 0);
}
