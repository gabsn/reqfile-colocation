import { invoiceTotal } from "./billing";
import { summary } from "./cart/checkout";

console.log(summary(100, "FR"), invoiceTotal(50, "DE"));
