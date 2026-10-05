import { sendDigest } from "./notifications";
import { weeklyReport } from "./reports";

sendDigest("team@example.com", ["Release 2.1 shipped", "Two new issues"]);
console.log(weeklyReport(40, ["Fix login redirect", "Speed up search"]));
