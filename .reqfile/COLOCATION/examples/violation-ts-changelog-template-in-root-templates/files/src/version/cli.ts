import { bump } from "./index";

const [version = "0.0.0", part = "patch"] = process.argv.slice(2);
console.log(bump(version, part as "major" | "minor" | "patch"));
