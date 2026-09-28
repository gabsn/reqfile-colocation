export type Cents = number;

export function formatCents(cents: Cents): string {
  return `${(cents / 100).toFixed(2)} EUR`;
}
