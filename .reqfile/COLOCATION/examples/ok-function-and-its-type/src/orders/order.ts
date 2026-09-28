export type Order = { id: string; totalCents: number };

export function parseOrder(raw: string): Order {
  const [id, total] = raw.split(";");
  return { id, totalCents: Number(total) };
}
