export function invoiceNumber(year: number, sequence: number): string {
  return `${year}-${String(sequence).padStart(5, "0")}`;
}
