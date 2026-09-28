import { formatInvoiceNumber } from "../utils/formatInvoiceNumber";

export function invoiceTitle(seq: number, year: number): string {
  return `Invoice ${formatInvoiceNumber(seq, year)}`;
}
