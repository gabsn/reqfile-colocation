import type { Invoice } from "../models/invoice";

export function issue(net: number): Invoice {
  return { net, tax: Math.round(net / 5) };
}
