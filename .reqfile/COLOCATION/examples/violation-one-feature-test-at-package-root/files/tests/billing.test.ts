import { bill } from "../src/billing";
if (bill() !== 1) throw new Error("bill");
