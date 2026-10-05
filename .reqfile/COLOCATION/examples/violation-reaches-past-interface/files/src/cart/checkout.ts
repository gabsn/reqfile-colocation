import { invoiceTotal } from "../billing";
import { taxFor } from "../billing/tax";

export function summary(net: number, country: string): string {
  return `tax ${taxFor(net, country)}, total ${invoiceTotal(net, country)}`;
}
