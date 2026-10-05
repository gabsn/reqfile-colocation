import { readFileSync } from "node:fs";
import { renderChangelog } from "./render";

const i = process.argv.indexOf("--template");
if (i < 0 || !process.argv[i + 1]) throw new Error("missing --template");

const template = readFileSync(process.argv[i + 1], "utf8");
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const entries = readFileSync(0, "utf8").split("\n").filter((line) => line.trim() !== "");
process.stdout.write(renderChangelog(template, version, entries));
