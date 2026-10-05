import { taxFor } from "./tax";

/** The interface of billing: what other features may use. */
export function invoiceTotal(net: number, country: string): number {
  return net + taxFor(net, country);
}
