import { formatCents, type Cents } from "../money";

export function cartTotal(lines: Cents[]): string {
  return formatCents(lines.reduce((a, b) => a + b, 0));
}
