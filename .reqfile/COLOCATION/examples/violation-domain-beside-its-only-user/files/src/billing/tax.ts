const RATES: Record<string, number> = { FR: 0.2, DE: 0.19 };

export function taxFor(net: number, country: string): number {
  return net * (RATES[country] ?? 0);
}
