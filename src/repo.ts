// The repository in the current folder: its files as git lists them, their
// text, and the optional colocation.yaml. Parsed once, at the boundary.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

import * as paths from "./paths";

export type Repo = {
  /** Absolute path of the repository root (the current folder). */
  root: string;
  /** Every file git tracks or would track, minus .git/ and .reqfile/. */
  files: Set<string>;
  /** Every folder holding a file, ancestors included, "" for the root. */
  folders: Set<string>;
  read: (path: string) => string;
  config: Config;
};

export type Config = {
  /** Roots whose features are declared: every other file must belong to one
   * feature or be listed as shared. */
  roots: { path: string; shared: string[] }[];
  /** Findings accepted on purpose; each must match at least one finding. */
  exceptions: { path: string; rule: string; reason: string }[];
  /** Packages or folders declared shared tools: a folder named like one of
   * them that depends on it is its user, not its other half. */
  shared: string[];
};

export const CONFIG = "colocation.yaml";

/** Hidden folders that are not code: reqfile's own examples and caches. */
function skipped(path: string): boolean {
  return path.startsWith(".git/") || path.split("/").includes(".reqfile");
}

export function load(): Repo {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  const files = new Set(out.split("\0").filter((p) => p !== "" && !skipped(p)));
  const folders = new Set<string>([""]);
  for (const file of files) for (let d = paths.dir(file); d !== "" && !folders.has(d); d = paths.dir(d)) folders.add(d);
  const cache = new Map<string, string>();
  const read = (path: string) => {
    let text = cache.get(path);
    if (text === undefined) {
      text = readFileSync(path, "utf8");
      cache.set(path, text);
    }
    return text;
  };
  const config = files.has(CONFIG) ? parseConfig(read(CONFIG)) : { roots: [], exceptions: [], shared: [] };
  return { root: process.cwd(), files, folders, read, config };
}

/** colocation.yaml, strictly: an unknown key is an error, not a silent no-op. */
export function parseConfig(text: string): Config {
  const fail = (message: string): never => {
    throw new Error(`${CONFIG}: ${message}`);
  };
  const doc: unknown = parse(text) ?? {};
  if (typeof doc !== "object" || Array.isArray(doc)) fail("expected a mapping");
  const record = doc as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!["roots", "exceptions", "shared"].includes(key)) fail(`unknown key \`${key}\``);
  const list = (value: unknown, where: string): unknown[] =>
    value === undefined ? [] : Array.isArray(value) ? value : fail(`\`${where}\` must be a list`);
  const text_ = (value: unknown, where: string): string =>
    typeof value === "string" && value !== "" ? value : fail(`\`${where}\` must be a non-empty string`);
  const entry = (value: unknown, where: string, keys: string[]): Record<string, unknown> => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`each \`${where}\` entry must be a mapping`);
    for (const key of Object.keys(value as object)) if (!keys.includes(key)) fail(`unknown key \`${where}.${key}\``);
    return value as Record<string, unknown>;
  };
  return {
    roots: list(record.roots, "roots").map((r) => {
      const root = entry(r, "roots", ["path", "shared"]);
      return {
        path: paths.normalize(text_(root.path, "roots.path")) ?? fail("roots.path leaves the repository"),
        shared: list(root.shared, "roots.shared").map((s) => text_(s, "roots.shared")),
      };
    }),
    shared: list(record.shared, "shared").map((x) => paths.normalize(text_(x, "shared")) ?? fail("shared leaves the repository")),
    exceptions: list(record.exceptions, "exceptions").map((x) => {
      const e = entry(x, "exceptions", ["path", "rule", "reason"]);
      return { path: text_(e.path, "exceptions.path"), rule: text_(e.rule, "exceptions.rule"), reason: text_(e.reason, "exceptions.reason") };
    }),
  };
}
