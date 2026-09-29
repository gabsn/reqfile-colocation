import { issueInvoice } from "./billing/invoice";
import { addToCart } from "./cart/cart";

const cart = addToCart([], { sku: "tea", quantity: 2 });
console.log(issueInvoice(cart.length));
