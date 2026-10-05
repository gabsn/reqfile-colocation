// Rust: tree-sitter's Rust grammar reads each file; the module tree is built
// from every crate root (src/lib.rs, src/main.rs, src/bin/*, tests/*,
// benches/*, examples/*, build.rs) through `mod` declarations, `#[path]`
// included. `use` trees and qualified paths in code resolve to module files.
// rustc already enforces module interfaces: a path into `m::sub` compiles only
// if `m` declares `sub` visible, so no Rust dependency is a bypass.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Language, type Node, Parser } from "web-tree-sitter";

import type { Analysis, Boundary, Edge, Unverifiable } from "./graph";
import * as paths from "./paths";
import type { Repo } from "./repo";

/** inline: declared with a body in its parent's file (`mod x { ... }`). */
type Module = { file: string; segments: string[]; childDir: string; children: Map<string, Module>; inline?: boolean };
type Crate = { folder: string; name: string; roots: string[] };

let parser: Parser | undefined;

async function rustParser(): Promise<Parser> {
  if (parser) return parser;
  await Parser.init();
  const bundled = fileURLToPath(new URL("./tree-sitter-rust.wasm", import.meta.url));
  const wasm = existsSync(bundled) ? bundled : createRequire(import.meta.url).resolve("tree-sitter-rust/tree-sitter-rust.wasm");
  parser = new Parser();
  parser.setLanguage(await Language.load(wasm));
  return parser;
}

export async function analyze(repo: Repo): Promise<Analysis> {
  const crates = findCrates(repo);
  if (crates.length === 0) return { edges: [], boundaries: [], unverifiable: [] };
  const p = await rustParser();
  const trees = new Map<string, Node>();
  const unverifiable: Unverifiable[] = [];
  const parse = (file: string): Node | null => {
    if (trees.has(file)) return trees.get(file)!;
    const root = p.parse(repo.read(file))!.rootNode;
    if (root.hasError) {
      const bad = firstError(root);
      unverifiable.push({ path: file, line: bad ? bad.startPosition.row + 1 : undefined, reason: "does not parse as Rust" });
      return null;
    }
    trees.set(file, root);
    return root;
  };

  const edges: Edge[] = [];
  const boundaries: Boundary[] = [];
  for (const crate of crates) {
    const lib = paths.join(crate.folder, "src/lib.rs");
    const libTree = repo.files.has(lib) ? buildTree(repo, lib, parse, unverifiable) : undefined;
    for (const root of crate.roots) {
      const tree = root === lib && libTree ? libTree : buildTree(repo, root, parse, unverifiable);
      if (!tree) continue;
      if (root === lib || !libTree) collectBoundaries(tree, boundaries);
      // A file's inline modules are read with the file, in their own context.
      const read = new Set<string>();
      for (const module of walk(tree)) {
        const node = trees.get(module.file);
        if (!node || read.has(module.file)) continue;
        read.add(module.file);
        for (const use of pathsIn(node, module)) {
          const target = resolvePath(use.segments, use.context, tree, libTree, crate.name);
          if (target && target.file !== module.file) {
            edges.push({ from: module.file, to: target.file, kind: "import", line: use.line, items: target.item ? [target.item] : [] });
          }
        }
      }
    }
  }
  return { edges: dedupe(edges), boundaries: dedupeBoundaries(boundaries), unverifiable };
}

function findCrates(repo: Repo): Crate[] {
  const crates: Crate[] = [];
  for (const manifest of [...repo.files].filter((f) => paths.name(f) === "Cargo.toml")) {
    const text = repo.read(manifest);
    const pkg = text.match(/^\[package\][^[]*?^name\s*=\s*"([^"]+)"/ms);
    if (!pkg) continue;
    const folder = paths.dir(manifest);
    const roots = [...repo.files].filter((f) => {
      if (!f.endsWith(".rs") || !paths.within(f, folder)) return false;
      const rel = folder === "" ? f : f.slice(folder.length + 1);
      return (
        rel === "src/lib.rs" ||
        rel === "src/main.rs" ||
        rel === "build.rs" ||
        /^src\/bin\/[^/]+\.rs$/.test(rel) ||
        /^src\/bin\/[^/]+\/main\.rs$/.test(rel) ||
        /^(tests|benches|examples)\/[^/]+\.rs$/.test(rel) ||
        /^(tests|benches|examples)\/[^/]+\/main\.rs$/.test(rel)
      );
    });
    crates.push({ folder, name: pkg[1].replaceAll("-", "_"), roots });
  }
  // Roots belong to the innermost crate.
  for (const crate of crates) {
    crate.roots = crate.roots.filter(
      (r) => !crates.some((other) => other !== crate && other.folder.length > crate.folder.length && paths.within(r, other.folder)),
    );
  }
  return crates;
}

function buildTree(repo: Repo, root: string, parse: (f: string) => Node | null, unverifiable: Unverifiable[]): Module | undefined {
  const node = parse(root);
  if (!node) return undefined;
  const module: Module = { file: root, segments: [], childDir: paths.dir(root), children: new Map() };
  declareChildren(repo, module, node, parse, unverifiable, new Set([root]));
  return module;
}

/** The `mod` items of a module's body, files loaded and inline bodies walked. */
function declareChildren(
  repo: Repo,
  module: Module,
  body: Node,
  parse: (f: string) => Node | null,
  unverifiable: Unverifiable[],
  seen: Set<string>,
): void {
  for (const item of body.namedChildren) {
    if (!item || item.type !== "mod_item") continue;
    const name = item.childForFieldName("name")?.text;
    if (!name) continue;
    const inline = item.childForFieldName("body");
    if (inline) {
      const child: Module = { file: module.file, segments: [...module.segments, name], childDir: paths.join(module.childDir, name), children: new Map(), inline: true };
      module.children.set(name, child);
      declareChildren(repo, child, inline, parse, unverifiable, seen);
      continue;
    }
    const attribute = pathAttribute(item);
    // #[path] is relative to the file's folder, or inside an inline module,
    // to that module's folder (rustc: the inline modules count as folders).
    const candidates = attribute
      ? [paths.normalize(paths.join(module.inline ? module.childDir : paths.dir(module.file), attribute))]
      : [paths.join(module.childDir, `${name}.rs`), paths.join(module.childDir, `${name}/mod.rs`)];
    const file = candidates.find((c): c is string => c !== null && repo.files.has(c));
    if (!file) {
      unverifiable.push({
        path: module.file,
        line: item.startPosition.row + 1,
        reason: `\`mod ${name};\` has no file: looked for ${candidates.filter((c) => c !== null).join(", ")}`,
      });
      continue;
    }
    if (seen.has(file)) continue;
    const node = parse(file);
    const isModRs = paths.name(file) === "mod.rs";
    const childDir = attribute
      ? paths.join(paths.dir(file), isModRs ? "" : paths.name(file).slice(0, -3)).replace(/\/$/, "")
      : isModRs
        ? paths.dir(file)
        : paths.join(module.childDir, name);
    const child: Module = { file, segments: [...module.segments, name], childDir, children: new Map() };
    module.children.set(name, child);
    if (node) declareChildren(repo, child, node, parse, unverifiable, new Set([...seen, file]));
  }
}

/** `#[path = "..."]` on a mod item: the attributes just before it. */
function pathAttribute(item: Node): string | undefined {
  for (let prev = item.previousNamedSibling; prev && prev.type === "attribute_item"; prev = prev.previousNamedSibling) {
    const attribute = prev.namedChildren[0];
    if (attribute?.namedChildren[0]?.text === "path") {
      const literal = attribute.namedChildren.find((c) => c?.type === "string_literal");
      return literal?.text.slice(1, -1);
    }
  }
  return undefined;
}

function* walk(module: Module): Generator<Module> {
  yield module;
  for (const child of module.children.values()) yield* walk(child);
}

function collectBoundaries(tree: Module, boundaries: Boundary[]): void {
  for (const module of walk(tree)) {
    if (module.segments.length === 0 || module.children.size === 0) continue;
    const name = paths.name(module.file);
    const folder = name === "mod.rs" ? paths.dir(module.file) : paths.join(paths.dir(module.file), name.slice(0, -3));
    if ([...module.children.values()].some((c) => c.file !== module.file)) boundaries.push({ folder, entry: module.file });
  }
}

type Use = { segments: string[]; context: string[]; line: number };

/** Every path a file names: `use` trees, and qualified paths in its code,
 * each with the module it is written in (inline modules included). */
function pathsIn(file: Node, module: Module): Use[] {
  const found: Use[] = [];
  const visit = (node: Node, context: string[]) => {
    if (node.type === "mod_item") {
      const name = node.childForFieldName("name")?.text;
      const body = node.childForFieldName("body");
      if (name && body) for (const c of body.namedChildren) if (c) visit(c, [...context, name]);
      return;
    }
    if (node.type === "use_declaration") {
      const argument = node.childForFieldName("argument");
      if (argument) for (const segments of useTree(argument, [])) found.push({ segments, context, line: node.startPosition.row + 1 });
      return;
    }
    if (node.type === "token_tree") {
      // Macro arguments are tokens, not expressions: rebuild `a::b::c` runs.
      let run: string[] = [];
      let joined = false;
      const flush = () => {
        if (run.length > 1) found.push({ segments: run, context, line: node.startPosition.row + 1 });
        run = [];
      };
      for (const token of node.children) {
        if (!token) continue;
        if (["identifier", "crate", "self", "super"].includes(token.type) && (run.length === 0 || joined)) {
          run.push(token.text);
          joined = false;
        } else if (token.type === "::" && run.length > 0) joined = true;
        else {
          flush();
          joined = false;
          if (["identifier", "crate", "self", "super"].includes(token.type)) run = [token.text];
          if (token.type === "token_tree") visit(token, context);
        }
      }
      flush();
      return;
    }
    if (node.type === "scoped_identifier" || node.type === "scoped_type_identifier") {
      const segments = flatten(node);
      if (segments.length > 1) found.push({ segments, context, line: node.startPosition.row + 1 });
      return;
    }
    for (const c of node.namedChildren) if (c) visit(c, context);
  };
  // Inline modules of this file are walked with their own context.
  for (const c of file.namedChildren) if (c) visit(c, module.segments);
  return found;
}

/** The segments of a path expression or type path. */
function flatten(node: Node): string[] {
  if (node.type === "scoped_identifier" || node.type === "scoped_type_identifier") {
    const path = node.childForFieldName("path");
    const name = node.childForFieldName("name");
    return [...(path ? flatten(path) : []), ...(name ? [name.text] : [])];
  }
  if (["identifier", "type_identifier", "crate", "self", "super"].includes(node.type)) return [node.text];
  return [];
}

/** The paths a `use` tree imports, each as segments. */
function useTree(node: Node, prefix: string[]): string[][] {
  switch (node.type) {
    case "scoped_identifier":
    case "identifier":
    case "crate":
    case "self":
    case "super":
      return [[...prefix, ...flatten(node)].filter((s, i, all) => !(s === "self" && i === all.length - 1 && i > 0))];
    case "use_as_clause": {
      const path = node.childForFieldName("path");
      return path ? useTree(path, prefix) : [];
    }
    case "use_wildcard": {
      const inner = node.namedChildren[0];
      return [inner ? [...prefix, ...flatten(inner)] : prefix];
    }
    case "scoped_use_list": {
      const path = node.childForFieldName("path");
      const list = node.childForFieldName("list");
      const base = path ? [...prefix, ...flatten(path)] : prefix;
      return list ? useTree(list, base) : [base];
    }
    case "use_list":
      return node.namedChildren.flatMap((c) => (c ? useTree(c, prefix) : []));
    default:
      return [];
  }
}

/** The module a path reaches, and the item it names in it, if the path is
 * local: from `crate`, `self`, `super`, the crate's own name, or a child module
 * of the module it is written in. Other paths are external or items in scope. */
function resolvePath(
  segments: string[],
  context: string[],
  tree: Module,
  lib: Module | undefined,
  crateName: string,
): { file: string; item?: string } | null {
  let base: Module | undefined;
  let i = 0;
  const at = (root: Module, segs: string[]) => segs.reduce<Module | undefined>((m, s) => m?.children.get(s), root);
  if (segments[0] === "crate") [base, i] = [tree, 1];
  else if (segments[0] === "self") [base, i] = [at(tree, context), 1];
  else if (segments[0] === "super") {
    let up = 0;
    while (segments[up] === "super") up++;
    if (up > context.length) return null;
    [base, i] = [at(tree, context.slice(0, context.length - up)), up];
  } else if (segments[0] === crateName && lib) [base, i] = [lib, 1];
  else {
    const here = at(tree, context);
    if (here?.children.has(segments[0])) [base, i] = [here.children.get(segments[0]), 1];
    else return null;
  }
  if (!base) return null;
  while (i < segments.length && base.children.has(segments[i])) base = base.children.get(segments[i++])!;
  return { file: base.file, item: segments[i] };
}

function firstError(node: Node): Node | null {
  if (node.type === "ERROR" || node.isMissing) return node;
  for (const c of node.namedChildren) {
    if (!c) continue;
    if (c.hasError || c.type === "ERROR") {
      const found = firstError(c);
      if (found) return found;
    }
  }
  return null;
}

function dedupe(edges: Edge[]): Edge[] {
  const seen = new Map<string, Edge>();
  for (const e of edges) {
    const key = `${e.from}\0${e.to}\0${e.line}`;
    const known = seen.get(key);
    if (known) known.items = [...new Set([...known.items, ...e.items])];
    else seen.set(key, { ...e, items: [...e.items] });
  }
  return [...seen.values()];
}

function dedupeBoundaries(boundaries: Boundary[]): Boundary[] {
  return [...new Map(boundaries.map((b) => [b.folder, b])).values()];
}
