import { formatCents, type Cents } from "../money";

export function invoiceLine(label: string, amount: Cents): string {
  return `${label}: ${formatCents(amount)}`;
}
