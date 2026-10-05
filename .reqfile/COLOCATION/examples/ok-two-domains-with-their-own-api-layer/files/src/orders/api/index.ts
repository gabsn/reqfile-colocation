import { invoice } from "../../billing/api";
export const placeOrder = (id: string) => invoice(id);
