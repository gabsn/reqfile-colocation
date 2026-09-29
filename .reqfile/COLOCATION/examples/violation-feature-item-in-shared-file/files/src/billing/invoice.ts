import { formatMoney, invoiceTotal } from "../money";

export function invoiceFooter(lines: { cents: number }[]): string {
  return `Total: ${formatMoney(invoiceTotal(lines))}`;
}
