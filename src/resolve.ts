// Turns the imports of each file into edges between repository files.

import * as imports from "./imports";
import type { Import } from "./imports";
import * as paths from "./paths";
import * as source from "./source";

/** `from` uses `items` of `to`; no items means the whole file. */
export type Edge = { from: string; to: string; items: string[] };

/** The repository as the resolver sees it. */
export type Project = {
  /** Every file, by repository-relative path. */
  files: Set<string>;
  /** Source text of the files in a known language. */
  sources: Map<string, string>;
  /** Rust crates: the folder of each Cargo.toml and its package name. */
  crates: Map<string, string>;
  /** Folders Python absolute imports start from. */
  pythonRoots: string[];
};

export function edges(project: Project): Edge[] {
  const modules = rustModules(project);
  const found: Edge[] = [];
  for (const [path, text] of project.sources) {
    const lang = source.lang(path);
    const edges =
      lang === "script" ? script(project, path, imports.script(text))
      : lang === "python" ? python(project, path, imports.python(text))
      : lang === "rust" ? rust(project, modules, path, imports.rust(text))
      : [];
    found.push(...edges.filter((edge) => edge.to !== path));
  }
  return merge(found);
}

/** One edge per pair of files, with the union of their items. */
function merge(edges: Edge[]): Edge[] {
  const merged = new Map<string, { from: string; to: string; items: Set<string> | null }>();
  for (const edge of edges) {
    const key = `${edge.from}\0${edge.to}`;
    const entry = merged.get(key) ?? { from: edge.from, to: edge.to, items: new Set<string>() };
    merged.set(key, entry);
    if (edge.items.length === 0) entry.items = null;
    else if (entry.items) for (const item of edge.items) entry.items.add(item);
  }
  return [...merged.values()].map(({ from, to, items }) => ({ from, to, items: items ? [...items].sort() : [] }));
}

const SCRIPT_CANDIDATES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

function script(project: Project, from: string, found: Import[]): Edge[] {
  return found.flatMap((imp) => {
    const base = paths.normalize(paths.join(paths.dir(from), imp.module));
    if (base === null) return [];
    const to = SCRIPT_CANDIDATES.map((suffix) => base + suffix).find((c) => project.files.has(c));
    return to ? [{ from, to, items: imp.items }] : [];
  });
}

function python(project: Project, from: string, found: Import[]): Edge[] {
  const edges: Edge[] = [];
  for (const imp of found) {
    const dots = imp.module.match(/^\.*/)![0].length;
    const module = imp.module.slice(dots).replaceAll(".", "/");
    let bases = project.pythonRoots;
    if (dots > 0) {
      let base = paths.dir(from);
      for (let i = 1; i < dots; i++) base = paths.dir(base);
      bases = [base];
    }
    const find = (module: string) => {
      for (const base of bases) {
        const stem = paths.join(base, module);
        const hit = [`${stem}.py`, `${stem}/__init__.py`].find((c) => project.files.has(c));
        if (hit) return hit;
      }
      return undefined;
    };
    const items: string[] = [];
    for (const item of imp.items) {
      // `from pkg import module` names a file rather than an item.
      const file = find(paths.join(module, item));
      if (file) edges.push({ from, to: file, items: [] });
      else items.push(item);
    }
    if (imp.items.length === 0 || items.length > 0) {
      const to = find(module);
      if (to) edges.push({ from, to, items });
    }
  }
  return edges;
}

/** Module paths of each crate: crate folder -> module path ("a::b") -> file. */
type Modules = Map<string, Map<string, string>>;

function rustModules(project: Project): Modules {
  const modules: Modules = new Map();
  for (const path of [...project.files].filter((p) => p.endsWith(".rs"))) {
    const found = rustModuleOf(project, path);
    if (!found) continue;
    const [krate, segments] = found;
    const crateModules = modules.get(krate) ?? new Map<string, string>();
    modules.set(krate, crateModules);
    const key = segments.join("::");
    // A library root answers for the crate over a binary root.
    if (key === "" && crateModules.has(key) && !path.endsWith("lib.rs")) continue;
    crateModules.set(key, path);
  }
  return modules;
}

/** The crate folder of a file under its `src/`, and its module path. */
function rustModuleOf(project: Project, path: string): [string, string[]] | undefined {
  const krate = crateOf(project, path);
  if (krate === undefined) return undefined;
  const prefix = paths.join(krate, "src/");
  if (!path.startsWith(prefix) || !path.endsWith(".rs")) return undefined;
  let rel = path.slice(prefix.length, -3);
  if (rel.endsWith("/mod")) rel = rel.slice(0, -4);
  return [krate, rel === "main" || rel === "lib" ? [] : rel.split("/")];
}

function crateOf(project: Project, path: string): string | undefined {
  let dir = paths.dir(path);
  for (;;) {
    if (project.crates.has(dir)) return dir;
    if (dir === "") return undefined;
    dir = paths.dir(dir);
  }
}

function rust(project: Project, modules: Modules, from: string, uses: string[][]): Edge[] {
  const krate = crateOf(project, from);
  if (krate === undefined) return [];
  const crateModules = modules.get(krate) ?? new Map<string, string>();
  const has = (segments: string[]) => crateModules.has(segments.join("::"));
  const crateName = project.crates.get(krate)!.replaceAll("-", "_");
  const current = rustModuleOf(project, from)?.[1];
  const edges: Edge[] = [];
  for (const path of uses) {
    const [first] = path;
    let base: string[];
    let rest: string[];
    if (first === "crate" && current) [base, rest] = [[], path.slice(1)];
    else if (first === "self" && current) [base, rest] = [[...current], path.slice(1)];
    else if (first === "super" && current) {
      let supers = 0;
      while (path[supers] === "super") supers++;
      if (supers > current.length) continue;
      [base, rest] = [current.slice(0, current.length - supers), path.slice(supers)];
    } else if (first === crateName) [base, rest] = [[], path.slice(1)];
    else if (current && has([...current, first])) [base, rest] = [[...current, first], path.slice(1)];
    else continue;
    let i = 0;
    while (i < rest.length && has([...base, rest[i]])) base.push(rest[i++]);
    const to = crateModules.get(base.join("::"));
    if (to === undefined) continue;
    const item = rest[i];
    edges.push({ from, to, items: item !== undefined && item !== "self" ? [item] : [] });
  }
  return edges;
}
