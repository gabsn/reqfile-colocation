// The advisory check: placements likely wrong but not certain, because
// deciding them needs to know which files form one feature, which the code
// does not say. Each finding carries a probability; none blocks.

import type { Analysis, Edge } from "./graph";
import * as paths from "./paths";
import type { Repo } from "./repo";
import { isCrateRoot, isEntry, manifestOf, orRoot, rootFolders, homesOfTests, relativeTo, toolRequired, userFolder } from "./places";
import * as source from "./source";
import type { Violation } from "./verify";

/** The probability that a file breaks COLOCATION, and why. */
export type Judgment = { path: string; probability: number; message: string };

const LAYERED = 0.85;
const GRAB_BAG = 0.75;
const ITEM_BELOW = 0.75;
const LOOSE_FEATURE = 0.75;
/** Ownership read from who imports: right for a layer split, wrong when the
 * only user is a surface or a composition root, which the graph cannot tell. */
const OWNER = 0.8;
const PLACED = 0.1;

/** Folder names that group code by technical layer rather than by feature. */
const LAYERS = new Set([
  "model", "service", "repository", "repo", "controller", "view", "handler", "util", "helper", "constant", "type",
  "interface", "dto", "schema", "entity", "store", "reducer", "action", "selector", "style", "hook", "fixture",
  "mock", "manager", "provider", "adapter", "dao", "mapper",
]);

/** One judgment per judged file: the highest-probability finding, or a pass. */
export function judge(repo: Repo, analysis: Analysis): Judgment[] {
  const edges = analysis.edges.filter((e) => e.kind === "import");
  const text = (path: string) => (source.lang(path) ? repo.read(path) : "");
  const findings = new Map<string, [number, string][]>();
  const judged = new Set<string>();
  const add = (path: string, probability: number, message: string) => {
    judged.add(path);
    findings.set(path, [...(findings.get(path) ?? []), [probability, message]]);
  };
  const roots = rootFolders(repo);
  const users = new Map<string, Edge[]>();
  for (const edge of edges) users.set(edge.to, [...(users.get(edge.to) ?? []), edge]);
  for (const [target, targetEdges] of users) {
    if (source.isTest(target) || !repo.files.has(target)) continue;
    judged.add(target);
    const production = targetEdges.filter((e) => !source.isTest(e.from));
    for (const [items, folder] of itemsBelow(target, production, text(target))) {
      add(target, ITEM_BELOW, `${items.join(", ")} serve${items.length === 1 ? "s" : ""} only ${folder}/`);
    }
    // Inside a module, how its files group its items is free; at a root,
    // each file is a feature of its own.
    if (!roots.has(paths.dir(target))) continue;
    const clusters = grabBag(targetEdges, text(target));
    if (clusters) add(target, GRAB_BAG, `holds items that serve separate users: ${clusters}`);
  }
  for (const [path, message] of looseFeatures(roots, repo, edges)) add(path, LOOSE_FEATURE, message);
  for (const v of ownerRule(repo, analysis.edges)) add(v.path, OWNER, v.message);
  const inside = new Set(analysis.boundaries.map((b) => b.folder));
  for (const [path, message] of layered(repo.files, inside)) add(path, LAYERED, message);
  return [...judged].sort().map((path) => {
    const found = findings.get(path);
    if (!found) return { path, probability: PLACED, message: "no likely placement problem found" };
    return { path, probability: Math.max(...found.map(([p]) => p)), message: found.map(([, m]) => m).join("; ") };
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
function layered(files: Set<string>, boundaries: Set<string>): [string, string][] {
  const byParent = new Map<string, Map<string, string[]>>();
  for (const file of [...files].filter((f) => source.lang(f) !== undefined).sort()) {
    const folder = paths.dir(file);
    const layer = singular(paths.name(folder));
    if (!LAYERS.has(layer)) continue;
    // Inside a module with an interface, layer folders are its own business.
    if ([...boundaries].some((b) => paths.within(folder, b) && folder !== b)) continue;
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






/** Items of a file, grouped with the items their top-level block names, whose
 * production users all live in one folder below the file's: each group and
 * that folder. An item used from elsewhere may be what its module offers; one
 * used only below belongs down there. */
function itemsBelow(target: string, edges: Edge[], text: string): [string[], string][] {
  if (edges.length === 0 || edges.some((e) => e.items.length === 0)) return [];
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
    if (folder !== home && paths.within(folder, home)) away.push([[...group].sort(), folder]);
  }
  return away;
}



/** At a root, where each file is a feature: files no sibling uses are
 * entries, files only entries use are features, and a helper several
 * features use, but not all of them, makes those features and itself one
 * feature with no folder of its own. Each of its files, with that feature. */
function looseFeatures(roots: Set<string>, repo: Repo, edges: Edge[]): [string, string][] {
  const found: [string, string][] = [];
  for (const root of roots) {
    const siblings = [...repo.files].filter((f) => paths.dir(f) === root && source.lang(f) !== undefined && !source.isTest(f) && source.lang(f) !== "style");
    const usersOf = (file: string) => [...new Set(edges.filter((e) => e.to === file && !source.isTest(e.from)).map((e) => e.from))];
    const entries = new Set(siblings.filter((f) => usersOf(f).length === 0));
    const features = new Set(siblings.filter((f) => !entries.has(f) && usersOf(f).every((u) => entries.has(u))));
    for (const helper of siblings.filter((f) => !entries.has(f) && !features.has(f))) {
      const users = usersOf(helper);
      if (users.length < 2 || users.length >= features.size || !users.every((u) => features.has(u))) continue;
      const group = [...users, helper].sort();
      const message = `${group.map(paths.name).join(", ")} form one feature loose in ${(root === "" ? "." : root)}/; give it a folder of its own`;
      for (const file of group) found.push([file, message]);
    }
  }
  return found;
}


/** owner: what only one folder uses lives in it. A package (a folder with
 * its manifest) used only from one folder lives beside it, in its parent:
 * the evals of a product sit next to the product, not around it. */
function ownerRule(repo: Repo, edges: Edge[]): Violation[] {
  const targets = new Set(edges.map((e) => e.to));
  const testHomes = homesOfTests(repo, edges);
  const out: Violation[] = [];
  for (const target of [...targets].sort()) {
    if (source.consumer(target) || source.isTest(target) || isCrateRoot(repo, target) || toolRequired(repo, target)) continue;
    if (repo.files.has(target) && source.generated(target, source.lang(target) ? repo.read(target) : "")) continue;
    const folder = repo.folders.has(target) && !repo.files.has(target);
    // A plain folder named in a command is no unit of ownership; a package is.
    if (folder && !manifestOf(repo, target)) continue;
    const outside = edges.filter((e) =>
      folder ? paths.within(e.to, target) && !paths.within(e.from, target) : e.to === target && e.from !== target,
    );
    const production = outside.filter((e) => !source.isTest(e.from));
    const homes = production.map((e) => userFolder(e, repo)).filter((h): h is string => h !== null);
    let home: string;
    let users: string[];
    if (homes.length > 0) {
      home = paths.commonFolder(homes);
      users = [...new Set(production.filter((e) => userFolder(e, repo) !== null).map((e) => e.from))];
    } else {
      // Test support (fixtures) follows its tests, when tests import it: a
      // path a test names says little, as code may reach the file unseen.
      const tests = [...new Set(outside.filter((e) => source.isTest(e.from) && e.kind === "import").map((e) => e.from))];
      if (tests.length === 0 || production.length > 0) continue;
      home = paths.commonFolder(tests.map((t) => testHomes.get(t) ?? paths.dir(t)));
      users = tests;
    }
    const only = folder || homes.length === 0 ? undefined : soleSiblingUser(repo, target, users, edges);
    if (only) {
      out.push({
        path: target,
        rule: "owner",
        message: `only ${paths.name(only)} uses ${paths.name(target)}: make it part of ${paths.name(only)}'s module (in the file, or a folder of its own)`,
      });
      continue;
    }
    const pkg = folder && [...repo.files].some((f) => source.manifest(f) && paths.dir(f) === target);
    const place = pkg ? paths.dir(home) : home;
    if (paths.within(target, place)) continue;
    const where = folder ? `${target}/` : target;
    const location = folder ? (manifestOf(repo, target) ?? target) : target;
    out.push({
      path: location,
      rule: "owner",
      message: `${where} is used only from ${orRoot(home)}/ (${users.map((u) => relativeTo(home, u)).join(", ")}); move it ${pkg ? "beside" : "into"} ${orRoot(pkg ? place : home)}/`,
    });
  }
  return out;
}

/** At a root, where each file is a feature of its own (a package or crate
 * root, its src/, a root declared in colocation.yaml), a module that one other
 * file alone uses belongs to that file's module, unless that file only wires
 * others together: an entry point, or a folder's interface or root (index,
 * mod.rs, lib.rs, main, __init__.py). Inside a feature's folder, files serving
 * one another are already together. */
function soleSiblingUser(repo: Repo, target: string, users: string[], edges: Edge[]): string | undefined {
  if (users.length !== 1 || source.lang(target) === undefined || !rootFolders(repo).has(paths.dir(target))) return undefined;
  const [user] = users;
  if (source.generated(user, repo.read(user))) return undefined;
  if (paths.dir(user) !== paths.dir(target) || source.lang(user) === undefined) return undefined;
  if (/^(index\.[a-z]+|mod\.rs|lib\.rs|main\.[a-z]+|__init__\.py)$/.test(paths.name(user))) return undefined;
  if (isEntry(repo, user, edges.filter((e) => e.to === user))) return undefined;
  return user;
}
