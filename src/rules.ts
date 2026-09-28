// Judges where each file lives, given the files that use it.

import * as paths from "./paths";
import type { Edge } from "./resolve";
import * as source from "./source";

/** The probability that a file breaks COLOCATION, and why. */
export type Judgment = { path: string; probability: number; message: string };

const MISPLACED = 0.9;
const TEST_AWAY = 0.85;
const LAYERED = 0.85;
const GRAB_BAG = 0.75;
const PLACED = 0.1;

/** Folder names that group code by technical layer rather than by feature. */
const LAYERS = new Set([
  "model", "service", "repository", "repo", "controller", "view", "handler", "util", "helper", "constant", "type",
  "interface", "dto", "schema", "entity", "store", "reducer", "action", "selector", "style", "hook", "fixture",
  "mock", "manager", "provider", "adapter", "dao", "mapper",
]);

/** One judgment per judged file: the highest-probability finding, or a pass. */
export function judge(
  files: Set<string>,
  sources: Map<string, string>,
  edges: Edge[],
  crates: Set<string>,
): Judgment[] {
  const findings = new Map<string, [number, string][]>();
  const judged = new Set<string>();
  const add = (path: string, probability: number, message: string) => {
    findings.set(path, [...(findings.get(path) ?? []), [probability, message]]);
  };

  const subjectsOfTests = new Set<string>();
  for (const test of [...files].filter((f) => source.isTest(f) && !toolRequired(f, crates))) {
    const imported = edges.filter((e) => e.from === test && !source.isTest(e.to)).map((e) => e.to);
    const named = imported.filter((to) => source.stem(to) === source.stem(test));
    const subjects = named.length > 0 ? named : imported;
    if (subjects.length === 0) continue;
    subjects.forEach((s) => subjectsOfTests.add(s));
    judged.add(test);
    const home = paths.commonFolder(subjects.map(paths.dir));
    if (!paths.within(paths.dir(test), home)) {
      add(test, TEST_AWAY, `${test} tests ${subjects.join(", ")} but lives outside ${orRoot(home)}/`);
    }
  }

  const users = new Map<string, Edge[]>();
  for (const edge of edges) users.set(edge.to, [...(users.get(edge.to) ?? []), edge]);
  for (const [target, targetEdges] of users) {
    if (source.isTest(target) || isRoot(target, crates)) continue;
    const production = targetEdges.map((e) => e.from).filter((from) => !source.isTest(from));
    let placing: string[];
    if (production.length > 0) placing = production;
    else if (subjectsOfTests.has(target)) continue; // judged from its tests
    else placing = targetEdges.map((e) => e.from);
    judged.add(target);
    const home = paths.commonFolder(placing.map(paths.dir));
    if (!paths.within(paths.dir(target), home)) {
      add(target, MISPLACED, `${target} is used only from ${orRoot(home)}/ (${placing.join(", ")}) but lives outside it`);
    }
    const clusters = grabBag(targetEdges, sources.get(target) ?? "");
    if (clusters) add(target, GRAB_BAG, `${target} holds items that serve separate users: ${clusters}`);
  }

  for (const [path, message] of layered(files)) {
    judged.add(path);
    add(path, LAYERED, message);
  }

  return [...judged].sort().map((path) => {
    const found = findings.get(path);
    if (!found) return { path, probability: PLACED, message: "lives with the code that uses it" };
    return {
      path,
      probability: Math.max(...found.map(([p]) => p)),
      message: found.map(([, m]) => m).join("; "),
    };
  });
}

function orRoot(folder: string): string {
  return folder === "" ? "." : folder;
}

/** Rust integration tests, benches and examples next to Cargo.toml, and migrations. */
function toolRequired(path: string, crates: Set<string>): boolean {
  const parts = path.split("/");
  return parts.some(
    (part, i) =>
      part === "migrations" ||
      (["tests", "benches", "examples"].includes(part) && crates.has(parts.slice(0, i).join("/"))),
  );
}

/** Crate roots are reached through the crate name, from anywhere. */
function isRoot(path: string, crates: Set<string>): boolean {
  return ["src/main.rs", "src/lib.rs"].some((root) => {
    if (!path.endsWith(root)) return false;
    return crates.has(path.slice(0, -root.length).replace(/\/$/, ""));
  });
}

type Group = { items: Set<string>; users: Set<string> };

/** When the items of a file split into groups used by disjoint sets of
 * files, those groups, described; null when the file is one piece. Items
 * named in one top-level block of the file, such as a function and the type
 * it returns, are one piece whoever uses them. */
function grabBag(edges: Edge[], text: string): string | null {
  if (edges.some((e) => e.items.length === 0)) return null;
  const items = new Set(edges.flatMap((e) => e.items));
  const related: Group[] = blocks(text)
    .map((block) => ({ items: new Set([...items].filter((item) => mentions(block, item))), users: new Set<string>() }))
    .filter((g) => g.items.size > 1);
  const uses: Group[] = edges.map((e) => ({ items: new Set(e.items), users: new Set([e.from]) }));
  // Each group: items that share a user or a block, and their users.
  let groups: Group[] = [];
  for (const merged of [...related, ...uses]) {
    groups = groups.filter((g) => {
      if (![...g.items].some((item) => merged.items.has(item))) return true;
      g.items.forEach((item) => merged.items.add(item));
      g.users.forEach((user) => merged.users.add(user));
      return false;
    });
    groups.push(merged);
  }
  if (groups.length < 2) return null;
  return groups.map((g) => `${[...g.items].sort().join(", ")} for ${[...g.users].sort().join(", ")}`).join("; ");
}

/** The top-level blocks of a source file: each starts at an unindented line
 * that does not close or continue the previous one. */
function blocks(text: string): string[] {
  const found: string[] = [];
  let current = "";
  for (const line of text.split(/(?<=\n)/)) {
    const opens = line !== "" && !/^[\s})\]]/.test(line);
    if (opens && current !== "") {
      found.push(current);
      current = "";
    }
    current += line;
  }
  found.push(current);
  return found;
}

/** Whether `text` contains `word` as a whole identifier. */
function mentions(text: string, word: string): boolean {
  return new RegExp(`(?<![\\w])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`).test(text);
}

/** Files of one feature spread over sibling layer folders, such as
 * models/invoice.py, services/invoice_service.py. */
function layered(files: Set<string>): [string, string][] {
  const byParent = new Map<string, Map<string, string[]>>();
  for (const file of [...files].filter((f) => source.lang(f) !== undefined).sort()) {
    const folder = paths.dir(file);
    const layer = singular(paths.name(folder));
    if (!LAYERS.has(layer)) continue;
    const feature = words(paths.name(file).split(".")[0]).filter((w) => w !== layer && !LAYERS.has(w));
    if (feature.length === 0 || ["init", "index"].includes(feature.join("_"))) continue;
    const features = byParent.get(paths.dir(folder)) ?? new Map<string, string[]>();
    byParent.set(paths.dir(folder), features);
    const key = feature.join("_");
    features.set(key, [...(features.get(key) ?? []), file]);
  }
  const found: [string, string][] = [];
  for (const features of byParent.values()) {
    for (const [feature, featureFiles] of features) {
      const folders = [...new Set(featureFiles.map(paths.dir))].sort();
      if (folders.length < 2) continue;
      const list = folders.map((f) => `${paths.name(f)}/`).join(", ");
      for (const file of featureFiles) {
        found.push([file, `feature \`${feature}\` is split across layer folders ${list}; group it in one folder`]);
      }
    }
  }
  return found;
}

function singular(word: string): string {
  word = word.toLowerCase();
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ss")) return word;
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

/** `invoice_repository`, `invoiceRepository`, `invoice-repository` -> [invoice, repository]. */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[_\-]+/)
    .filter((w) => w !== "")
    .map(singular);
}
