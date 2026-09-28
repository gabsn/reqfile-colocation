import type { Order } from "../orders/order";

export function total(orders: Order[]): number {
  return orders.reduce((sum, order) => sum + order.totalCents, 0);
}
