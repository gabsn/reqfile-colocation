import { parseOrder } from "../orders/order";

export function handle(body: string): string {
  return parseOrder(body).id;
}
