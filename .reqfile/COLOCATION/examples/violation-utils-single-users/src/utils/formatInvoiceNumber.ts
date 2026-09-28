export function formatInvoiceNumber(seq: number, year: number): string {
  return `${year}-${String(seq).padStart(6, "0")}`;
}
