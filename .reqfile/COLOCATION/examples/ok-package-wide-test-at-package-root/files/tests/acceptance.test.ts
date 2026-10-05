import { bill } from "../src/billing";
import { ship } from "../src/shipping";
if (bill() + ship() !== 3) throw new Error("x");
