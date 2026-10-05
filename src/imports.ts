// The imports written in a file, per language, before resolution.
// Regular expressions rather than parsers: fast, and enough to measure.

/** An import of `items` from a module; no items means the whole module. */
export type Import = { module: string; items: string[] };

const SCRIPT_FROM = /^[ \t]*(?:import|export)[ \t]+([^;=()'"]*?)[ \t\n]*from[ \t]*['"]([^'"\n]+)['"]/gm;
const SCRIPT_BARE = /^[ \t]*import[ \t]*['"]([^'"\n]+)['"]|(?:require|import)\(\s*['"]([^'"\n]+)['"]\s*\)/gm;

/** Imports of a TS or JS file; `module` is the specifier. Packages are kept:
 * resolution drops what is not a file of the repository, and resolves path
 * aliases such as `@/utils/x`. */
export function script(text: string): Import[] {
  const imports: Import[] = [];
  for (const m of text.matchAll(SCRIPT_FROM)) imports.push({ module: m[2], items: scriptItems(m[1]) });
  for (const m of text.matchAll(SCRIPT_BARE)) imports.push({ module: m[1] ?? m[2], items: [] });
  return imports;
}

function scriptItems(clause: string): string[] {
  clause = clause.trim().replace(/^type\s+/, "").trim();
  if (clause.includes("*")) return [];
  const brace = clause.indexOf("{");
  const defaultPart = brace < 0 ? clause : clause.slice(0, brace);
  const named = brace < 0 ? "" : clause.slice(brace + 1).replace(/[}\s]*$/, "");
  const items = named
    .split(",")
    .map((item) => item.trim().replace(/^type\s+/, "").split(" as ")[0].trim())
    .filter((item) => item !== "");
  if (defaultPart.trim().replace(/,$/, "").trim() !== "") items.push("default");
  return items;
}

const PY_FROM = /^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n#]+)/gm;
const PY_IMPORT = /^[ \t]*import[ \t]+([^\n#]+)/gm;

/** Python imports; `module` keeps its leading dots. */
export function python(text: string): Import[] {
  const imports: Import[] = [];
  for (const m of text.matchAll(PY_FROM)) {
    const items = m[2]
      .replace(/^[\s(]+|[\s)]+$/g, "")
      .split(",")
      .map((item) => item.split(" as ")[0].trim())
      .filter((item) => item !== "");
    imports.push({ module: m[1], items: items.includes("*") ? [] : items });
  }
  for (const m of text.matchAll(PY_IMPORT)) {
    for (const part of m[1].split(",")) {
      const module = part.split(" as ")[0].trim();
      if (module !== "") imports.push({ module, items: [] });
    }
  }
  return imports;
}

const RUST_USE = /\buse\s+([^;]+);/g;
const RUST_PATH = /\b[a-z_][a-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)+/g;

/** Rust paths from `use` declarations and from `module::Item` expressions,
 * as segments; resolution decides which of them name modules of the crate. */
export function rust(text: string): string[][] {
  const found: string[] = [];
  for (const m of text.matchAll(RUST_USE)) {
    for (const path of expandUseTree(m[1])) found.push(path.split(" as ")[0].replace(/\s+/g, ""));
  }
  // Paths inside `use` declarations were expanded above; scanning them again
  // would read `a::{B}` as a use of the whole module `a`.
  const body = text.replace(RUST_USE, "");
  for (const m of body.matchAll(RUST_PATH)) found.push(m[0]);
  return found.map((path) =>
    path
      .replace(/^::/, "")
      .split("::")
      .filter((seg) => seg !== "*"),
  );
}

/** `a::{B, c::{D, self}}` into `a::B`, `a::c::D`, `a::c::self`. */
function expandUseTree(tree: string): string[] {
  tree = tree.trim();
  const open = tree.indexOf("{");
  if (open < 0) return [tree];
  const prefix = tree.slice(0, open);
  const close = tree.lastIndexOf("}");
  const inner = tree.slice(open + 1, close < 0 ? tree.length : close);
  return splitTopLevel(inner)
    .filter((part) => part.trim() !== "")
    .flatMap((part) => expandUseTree(part).map((path) => prefix + path));
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}
