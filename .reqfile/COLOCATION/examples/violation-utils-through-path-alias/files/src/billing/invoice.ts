import { formatInvoiceNumber } from "@/utils/formatInvoiceNumber";

export function invoiceTitle(year: number, sequence: number): string {
  return `Invoice ${formatInvoiceNumber(year, sequence)}`;
}
