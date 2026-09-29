import type { Address } from "./types";

export function shippingLabel(address: Address): string {
  return `${address.street}\n${address.postcode} ${address.city}`;
}
