import { formatMoney } from "../money";

export function cartBadge(cents: number): string {
  return formatMoney(cents);
}
