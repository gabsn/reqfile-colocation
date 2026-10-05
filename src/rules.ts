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
const ITEM_AWAY = 0.75;
const PAST_INTERFACE = 0.8;
const THICK_ENTRY = 0.8;
/** Lines of shell a workflow step may hold before it is a feature's logic. */
const ENTRY_LINES = 5;
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
  workflows: Map<string, string> = new Map(),
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
      add(test, TEST_AWAY, `tests ${subjects.join(", ")} from outside ${orRoot(home)}/`);
    }
  }

  const roots = rootFolders(files);
  const interfaceOf = interfaces(files, sources);
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
    const misplaced = !paths.within(paths.dir(target), home);
    if (misplaced) {
      add(target, MISPLACED, `used only from ${orRoot(home)}/ (${placing.map((u) => relativeTo(home, u)).join(", ")})`);
    }
    const text = sources.get(target) ?? "";
    // An interface faces its module's users: each item may serve one of them.
    const facesUsers = misplaced || [...interfaceOf.values()].includes(target);
    for (const [items, folder] of facesUsers ? [] : itemsAway(target, targetEdges, text)) {
      add(target, ITEM_AWAY, `${items.join(", ")} serve${items.length === 1 ? "s" : ""} only ${folder}/`);
    }
    // Inside a module, how its files group its items is free; at a root,
    // each file is a feature of its own.
    if (!roots.has(paths.dir(target))) continue;
    const clusters = grabBag(targetEdges, text);
    if (clusters) add(target, GRAB_BAG, `holds items that serve separate users: ${clusters}`);
  }

  for (const edge of edges) {
    if (source.isTest(edge.from)) continue;
    const reached = pastInterface(edge, interfaceOf, sources);
    if (!reached) continue;
    const [folder, entry] = reached;
    judged.add(edge.from);
    add(edge.from, PAST_INTERFACE, `reaches into ${folder}/ past its interface ${paths.name(entry)} (imports ${relativeTo(folder, edge.to)})`);
  }

  for (const [path, message] of thickEntryPoints(workflows, files)) {
    judged.add(path);
    add(path, THICK_ENTRY, message);
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

/** `path` relative to `folder` when inside it, as people read it in a message. */
function relativeTo(folder: string, path: string): string {
  return folder !== "" && path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;
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

/** The interface file of each folder that declares one: an index.ts,
 * __init__.py or mod.rs (or the Rust file named after the folder) that
 * exports items of its own, rather than only listing submodules. */
function interfaces(files: Set<string>, sources: Map<string, string>): Map<string, string> {
  const found = new Map<string, string>();
  const folders = new Set<string>();
  for (const file of files) for (let d = paths.dir(file); d !== "" && !folders.has(d); d = paths.dir(d)) folders.add(d);
  for (const [path, text] of sources) {
    const name = paths.name(path);
    let folder: string | undefined;
    if (/^index\.(ts|tsx|js|jsx|mjs)$/.test(name) && /^\s*export\b/m.test(text)) folder = paths.dir(path);
    else if (name === "__init__.py" && /^(def|class|from|import|[A-Za-z_]\w*\s*=)/m.test(text)) folder = paths.dir(path);
    else if (name.endsWith(".rs") && /^\s*pub(\([^)]*\))?\s+(use|fn|struct|enum|trait|type|const|static)\b/m.test(text)) {
      if (name === "mod.rs") folder = paths.dir(path);
      else {
        const named = paths.join(paths.dir(path), name.slice(0, -3));
        if (folders.has(named)) folder = named;
      }
    }
    if (folder !== undefined && folder !== "") found.set(folder, path);
  }
  return found;
}

/** When `edge` enters a folder from outside and lands on a file other than
 * that folder's interface: the folder and its interface. A Rust path cannot
 * reach a private submodule (`mod add;`), so a path naming one, such as
 * `pins::add` for an item re-exported under that name, is not counted. */
function pastInterface(edge: Edge, interfaceOf: Map<string, string>, sources: Map<string, string>): [string, string] | null {
  const common = paths.commonFolder([paths.dir(edge.from), paths.dir(edge.to)]);
  const inner = paths.dir(edge.to).split("/").slice(common === "" ? 0 : common.split("/").length);
  let folder = common;
  for (const part of inner) {
    folder = paths.join(folder, part);
    const entry = interfaceOf.get(folder);
    if (entry === undefined) continue;
    if (entry === edge.to || privateRustModule(entry, folder, edge.to, sources)) return null;
    return [folder, entry];
  }
  return null;
}

/** Whether `target` is a submodule its folder's Rust interface declares private. */
function privateRustModule(entry: string, folder: string, target: string, sources: Map<string, string>): boolean {
  if (!entry.endsWith(".rs") || !target.endsWith(".rs")) return false;
  const rest = target.slice(folder.length + 1);
  const name = rest.split("/")[0].replace(/\.rs$/, "");
  return new RegExp(`^\\s*mod\\s+${name}\\s*;`, "m").test(sources.get(entry) ?? "");
}

const MANIFESTS = new Set(["package.json", "Cargo.toml", "pyproject.toml", "setup.py"]);

/** Folders where each file is a feature of its own: the repository root, each
 * package or crate root, and its src/. */
function rootFolders(files: Set<string>): Set<string> {
  const roots = new Set([""]);
  for (const file of files) {
    if (!MANIFESTS.has(paths.name(file))) continue;
    roots.add(paths.dir(file));
    roots.add(paths.join(paths.dir(file), "src"));
  }
  return roots;
}

/** Items of a file, grouped with the items their top-level block names, whose
 * users all live in a folder that does not contain the file: each group and
 * that folder. */
function itemsAway(target: string, edges: Edge[], text: string): [string[], string][] {
  if (edges.some((e) => e.items.length === 0)) return [];
  const items = [...new Set(edges.flatMap((e) => e.items))];
  let groups: Set<string>[] = items.map((item) => new Set([item]));
  for (const block of blocks(text)) {
    const named = new Set(items.filter((item) => mentions(block, item)));
    if (named.size < 2) continue;
    const merged = new Set(named);
    groups = groups.filter((g) => {
      if (![...g].some((item) => named.has(item))) return true;
      g.forEach((item) => merged.add(item));
      return false;
    });
    groups.push(merged);
  }
  const home = paths.dir(target);
  const away: [string[], string][] = [];
  for (const group of groups) {
    const users = edges.filter((e) => e.items.some((item) => group.has(item))).map((e) => paths.dir(e.from));
    const folder = paths.commonFolder(users);
    if (!paths.within(home, folder)) away.push([[...group].sort(), orRoot(folder)]);
  }
  return away;
}

/** Workflow steps whose `run:` holds several lines of shell working on a
 * top-level folder's files, rather than calling a script that lives there. */
function thickEntryPoints(workflows: Map<string, string>, files: Set<string>): [string, string][] {
  const folders = new Set([...files].filter((f) => f.includes("/")).map((f) => f.split("/")[0]));
  const found: [string, string][] = [];
  for (const [path, text] of workflows) {
    for (const script of runBlocks(text)) {
      const lines = script.split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
      if (lines.length < ENTRY_LINES) continue;
      const named = [...folders].filter((f) => new RegExp(`(^|[\\s"'=])${f}/`).test(script));
      if (named.length === 0) continue;
      found.push([path, `runs ${lines.length} lines of shell on ${named.map((f) => `${f}/`).join(", ")} inline; move them into a script in that folder and call it`]);
    }
  }
  return found;
}

/** The scripts of a workflow's `run:` keys: a one-line value, or a `|` / `>`
 * block, whose lines are those indented deeper than the key. */
function runBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  lines.forEach((line, i) => {
    const m = line.match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!m) return;
    const value = m[2].trim();
    if (!/^[|>][-+]?$/.test(value)) {
      if (value !== "") blocks.push(value);
      return;
    }
    const indent = line.length - line.trimStart().length;
    const body: string[] = [];
    for (const next of lines.slice(i + 1)) {
      if (next.trim() !== "" && next.length - next.trimStart().length <= indent) break;
      body.push(next);
    }
    blocks.push(body.join("\n"));
  });
  return blocks;
}
