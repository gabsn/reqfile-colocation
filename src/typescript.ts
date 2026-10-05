// TypeScript and JavaScript: imports read from TypeScript's own syntax tree,
// resolved by TypeScript's module resolution with the nearest tsconfig.json or
// jsconfig.json (extends, paths, baseUrl, package exports). A folder with an
// index file that exports is a boundary, and that file its interface.

import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

import type { Analysis, Boundary, Edge, Unverifiable } from "./graph";
import type { Command } from "./references";
import * as paths from "./paths";
import type { Repo } from "./repo";
import * as source from "./source";

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const INDEX = /^index\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const CONFIGS = ["tsconfig.json", "jsconfig.json"];

const DEFAULTS: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
  resolveJsonModule: true,
  allowArbitraryExtensions: true,
  jsx: ts.JsxEmit.Preserve,
};

/** A `paths` entry: `@/*` -> ["src/*"], targets as repository paths. */
type Alias = { prefix: string; exact: boolean; targets: string[] };
type Config = { options: ts.CompilerOptions; aliases: Alias[] } | { error: string };

/** A specifier as written, with what it names. */
type Specifier = { text: string; line: number; items: string[] };

export function analyze(repo: Repo): { analysis: Analysis; literals: Command[] } {
  const code = [...repo.files].filter((f) => CODE.test(f));
  const edges: Edge[] = [];
  const unverifiable: Unverifiable[] = [];
  const literals: Command[] = [];
  const configs = new Map<string, Config>();
  for (const file of code) {
    const config = configFor(repo, file, configs);
    if ("error" in config) {
      unverifiable.push({ path: file, reason: config.error });
      continue;
    }
    const text = repo.read(file);
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
    const errors = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
    if (errors.length > 0) {
      const at = errors[0].start === undefined ? undefined : sf.getLineAndCharacterOfPosition(errors[0].start).line + 1;
      unverifiable.push({ path: file, line: at, reason: `does not parse: ${ts.flattenDiagnosticMessageText(errors[0].messageText, " ")}` });
      continue;
    }
    literals.push(...pathLiterals(sf).map((l) => ({ file, ...l })));
    for (const spec of specifiers(sf)) {
      const resolved = resolve(repo, file, spec.text, config);
      if (resolved === "external") continue;
      if ("reason" in resolved) unverifiable.push({ path: file, line: spec.line, reason: resolved.reason });
      else edges.push({ from: file, to: resolved.path, kind: "import", line: spec.line, items: spec.items });
    }
  }
  const boundaries: Boundary[] = code
    .filter((f) => INDEX.test(paths.name(f)) && paths.dir(f) !== "" && /^\s*export\b/m.test(repo.read(f)))
    .map((entry) => ({ folder: paths.dir(entry), entry }));
  markBypasses(repo, edges, boundaries);
  return { analysis: { edges, boundaries, unverifiable }, literals };
}

/** An import entering a boundary must land on an interface: its own, or a
 * nested module's. Generated code is laid out by its tool, so neither side
 * of an edge that touches it is judged. */
function markBypasses(repo: Repo, edges: Edge[], boundaries: Boundary[]): void {
  const byFolder = new Map(boundaries.map((b) => [b.folder, b]));
  const entries = new Set(boundaries.map((b) => b.entry));
  for (const edge of edges) {
    if (!CODE.test(edge.to) || entries.has(edge.to)) continue;
    if ([edge.from, edge.to].some((f) => source.generated(f, repo.read(f)))) continue;
    const common = paths.commonFolder([paths.dir(edge.from), paths.dir(edge.to)]);
    let folder = common;
    for (const part of paths.dir(edge.to).split("/").slice(common === "" ? 0 : common.split("/").length)) {
      folder = paths.join(folder, part);
      const boundary = byFolder.get(folder);
      if (boundary) {
        edge.bypass = { boundary: boundary.folder, entry: boundary.entry };
        break;
      }
    }
  }
}

function scriptKind(file: string): ts.ScriptKind {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Every module specifier of a file: imports, re-exports, import =, and
 * import() or require() calls with a literal argument. */
function specifiers(sf: ts.SourceFile): Specifier[] {
  const found: Specifier[] = [];
  const line = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push({ text: node.moduleSpecifier.text, line: line(node), items: importItems(node.importClause) });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause;
      const items = clause && ts.isNamedExports(clause) ? clause.elements.map((e) => (e.propertyName ?? e.name).text) : [];
      found.push({ text: node.moduleSpecifier.text, line: line(node), items });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      found.push({ text: node.moduleReference.expression.text, line: line(node), items: [] });
    } else if (ts.isCallExpression(node) && node.arguments.length >= 1 && ts.isStringLiteralLike(node.arguments[0])) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) {
        found.push({ text: node.arguments[0].text, line: line(node), items: [] });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** String literals that may be paths, other than module specifiers. */
function pathLiterals(sf: ts.SourceFile): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteralLike(node) && node.text.includes("/") && !node.text.includes("\n") && node.text.length < 300) {
      const parent = node.parent;
      const specifier = parent && ts.isCallExpression(parent) && (parent.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(parent.expression) && parent.expression.text === "require"));
      if (!specifier) found.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function importItems(clause: ts.ImportClause | undefined): string[] {
  if (!clause) return [];
  const items: string[] = [];
  if (clause.name) items.push("default");
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) return [];
  if (bindings && ts.isNamedImports(bindings)) items.push(...bindings.elements.map((e) => (e.propertyName ?? e.name).text));
  return items;
}

/** The nearest tsconfig.json or jsconfig.json above a file, parsed by
 * TypeScript itself so `extends` and its defaults apply. */
function configFor(repo: Repo, file: string, cache: Map<string, Config>): Config {
  for (let dir = paths.dir(file); ; dir = paths.dir(dir)) {
    for (const name of CONFIGS) {
      const path = paths.join(dir, name);
      if (!repo.files.has(path)) continue;
      let config = cache.get(path);
      if (!config) {
        config = parseConfig(repo, path);
        cache.set(path, config);
      }
      return config;
    }
    if (dir === "") return { options: DEFAULTS, aliases: [] };
  }
}

function parseConfig(repo: Repo, path: string): Config {
  let fatal: string | undefined;
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      fatal = ts.flattenDiagnosticMessageText(d.messageText, " ");
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(join(repo.root, path), {}, host);
  // 18003: no input files, irrelevant to resolution.
  const error = fatal ?? parsed?.errors.find((e) => e.code !== 18003);
  if (error !== undefined || !parsed) {
    const message = typeof error === "string" ? error : error ? ts.flattenDiagnosticMessageText(error.messageText, " ") : "unreadable";
    return { error: `${path} does not parse: ${message}` };
  }
  const options = { ...DEFAULTS, ...parsed.options };
  const entries = Object.entries(options.paths ?? {});
  const base = options.pathsBasePath ?? options.baseUrl ?? join(repo.root, paths.dir(path));
  const alias = ([pattern, targets]: [string, string[]]): Alias => ({
    prefix: pattern.replace(/\*.*$/, ""),
    exact: !pattern.includes("*"),
    targets: targets.map((t) => relative(repo.root, join(String(base), t)).split("\\").join("/")),
  });
  return { options, aliases: entries.map(alias) };
}

let packages: Map<string, string> | undefined;

/** The repository's own package named by a bare specifier, from the `name`
 * of each package.json: its folder and the subpath after the name. */
function workspacePackage(repo: Repo, text: string): [string, string] | undefined {
  if (!packages) {
    packages = new Map();
    for (const f of repo.files) {
      if (paths.name(f) !== "package.json" || f.split("/").includes("node_modules")) continue;
      const name = (() => {
        try {
          return (JSON.parse(repo.read(f)) as { name?: unknown }).name;
        } catch {
          // A package.json that does not parse names no package.
          return undefined;
        }
      })();
      if (typeof name === "string" && name !== "") packages.set(name, paths.dir(f));
    }
  }
  for (const [name, folder] of packages) {
    if (text === name) return [folder, ""];
    if (text.startsWith(`${name}/`)) return [folder, text.slice(name.length + 1)];
  }
  return undefined;
}

/** The files a package.json declares for `subpath`: its `exports` entry
 * (conditions in order), or for the package itself, main, module, types. */
function declaredEntries(repo: Repo, folder: string, subpath: string): string[] {
  let doc: { exports?: unknown; main?: unknown; module?: unknown; types?: unknown };
  try {
    doc = JSON.parse(repo.read(paths.join(folder, "package.json")));
  } catch {
    // Unparsable: no declared entry; the guesses still apply.
    return [];
  }
  const all = (v: unknown): string[] =>
    typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(all) : typeof v === "object" && v !== null ? Object.values(v).flatMap(all) : [];
  const key = subpath === "" ? "." : `./${subpath}`;
  const exports = doc.exports;
  let targets: string[] = [];
  if (typeof exports === "object" && exports !== null && !Array.isArray(exports)) {
    const map = exports as Record<string, unknown>;
    if (Object.keys(map).some((k) => k.startsWith("."))) targets = all(map[key]);
    else if (subpath === "") targets = all(map);
  } else if (subpath === "") targets = all(exports);
  if (subpath === "") targets.push(...all(doc.main), ...all(doc.module), ...all(doc.types));
  return targets.map((t) => paths.normalize(paths.join(folder, t))).filter((t): t is string => t !== null);
}

/** A specifier as TypeScript resolves it from `file`: a repository file,
 * "external" for a package or built-in, or why it cannot be resolved. */
function resolve(
  repo: Repo,
  file: string,
  text: string,
  config: { options: ts.CompilerOptions; aliases: Alias[] },
): { path: string } | "external" | { reason: string } {
  text = text.replace(/[?#].*$/, "");
  const local = text.startsWith(".") || text.startsWith("/");
  const matched = local
    ? []
    : config.aliases.filter((a) => (a.exact ? text === a.prefix : a.prefix !== "" && text.startsWith(a.prefix)));
  const result = ts.resolveModuleName(text, join(repo.root, file), config.options, ts.sys).resolvedModule;
  if (result) {
    const path = relative(repo.root, result.resolvedFileName).split("\\").join("/");
    if (result.isExternalLibraryImport || path.startsWith("../") || path.split("/").includes("node_modules")) return "external";
    if (repo.files.has(path)) return { path };
    // Build output a generator writes and git ignores is the generator's.
    if (source.generated(path, "")) return "external";
    return { reason: `\`${text}\` resolves to ${path}, which git does not track` };
  }
  // Assets TypeScript does not resolve, through an alias: substitute it.
  for (const a of matched) {
    for (const target of a.targets) {
      const path = paths.normalize(a.exact ? target : target.replace("*", text.slice(a.prefix.length)));
      if (path !== null && repo.files.has(path)) return { path };
    }
  }
  if (local) {
    // Assets TypeScript does not resolve: stylesheets, images, data.
    const path = paths.normalize(paths.join(paths.dir(file), text));
    if (path !== null && path.split("/").includes("node_modules")) return "external";
    if (path !== null && repo.files.has(path)) return { path };
    if (path !== null && existsSync(join(repo.root, path))) return { reason: `\`${text}\` resolves to ${path}, which git does not track` };
    return { reason: `\`${text}\` does not resolve to a file` };
  }
  // An alias onto installed packages resolves once they are installed.
  const installed = (a: Alias) => a.targets.every((t) => t.split("/").includes("node_modules") || t.startsWith("../"));
  if (matched.length > 0 && !matched.every(installed)) {
    return { reason: `\`${text}\` matches a path alias but does not resolve to a file` };
  }
  // A workspace package of this repository, before or without installing:
  // its folder, then the subpath as TypeScript would look for a file.
  const workspace = workspacePackage(repo, text);
  if (workspace) {
    const [folder, subpath] = workspace;
    const declared = declaredEntries(repo, folder, subpath);
    const base = subpath === "" ? folder : paths.join(folder, subpath);
    const guesses = [base, ...["ts", "tsx", "js", "mjs"].flatMap((x) => [`${base}.${x}`, `${base}/index.${x}`, `${base}/src/index.${x}`])];
    for (const candidate of [...declared, ...guesses]) {
      if (repo.files.has(candidate)) return { path: candidate };
    }
    return { reason: `\`${text}\` names workspace package ${folder}/ but no file there` };
  }
  return "external";
}
