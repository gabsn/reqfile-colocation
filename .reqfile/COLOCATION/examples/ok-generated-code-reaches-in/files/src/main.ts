import { balance } from "./coins/balance";
import { routeTree } from "./routeTree.gen";

console.log(routeTree.length, balance({ coins: 3 }));
