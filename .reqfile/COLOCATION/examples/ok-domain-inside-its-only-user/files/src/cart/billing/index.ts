import { taxFor } from "./tax";

/** Billing: invoices and their taxes. */
export function invoiceTotal(net: number, country: string): number {
  return net + taxFor(net, country);
}

export function invoiceTax(net: number, country: string): number {
  return taxFor(net, country);
}
