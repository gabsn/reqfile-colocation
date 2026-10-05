import { invoiceTax, invoiceTotal } from "./billing";

export function summary(net: number, country: string): string {
  return `tax ${invoiceTax(net, country)}, total ${invoiceTotal(net, country)}`;
}
