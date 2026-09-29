import type { PaymentMethod } from "./types";

export function describePayment(method: PaymentMethod): string {
  return method.kind === "card" ? `card ending ${method.last4}` : "bank transfer";
}
