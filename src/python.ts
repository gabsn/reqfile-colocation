// Python: python3's own parser reads each file; imports resolve by Python's
// rules from the importing script's folder, the folders of pyproject.toml,
// setup.py or setup.cfg (and their src/), and the repository root. A package
// whose __init__.py defines __all__ or re-exports from its submodules is a
// boundary: a dependency passing through a name it exports goes through its
// interface; one entering a submodule it does not export bypasses it.

import { execFileSync } from "node:child_process";

import type { Analysis, Boundary, Edge, Unverifiable } from "./graph";
import type { Command } from "./references";
import * as paths from "./paths";
import type { Repo } from "./repo";

/** What python3 reports for one file. */
type Parsed = {
  path: string;
  error?: string;
  line?: number;
  imports: { module: string; level: number; names: string[]; line: number; from: boolean }[];
  /** __all__ when it is a literal list or tuple of strings. */
  all: string[] | null;
  /** Names bound at module level: imports, definitions, assignments. */
  bound: string[];
  /** Whether names can appear without being bound: `import *` or __getattr__. */
  open: boolean;
  /** Whether it imports from its own package (`from .x import y`). */
  reexports: boolean;
  literals: { text: string; line: number }[];
};

const READER = String.raw`
import ast, json, sys, warnings
warnings.simplefilter("ignore")

def parse(path):
    out = {"path": path, "imports": [], "all": None, "bound": [], "open": False, "reexports": False, "literals": []}
    try:
        tree = ast.parse(open(path, encoding="utf-8").read(), filename=path)
    except SyntaxError as e:
        out["error"] = "does not parse: " + str(e.msg)
        out["line"] = e.lineno
        return out
    except (UnicodeDecodeError, OSError) as e:
        out["error"] = "cannot be read: " + str(e)
        return out
    def module_level(body):
        # Statements run at import: the body and the branches of if, try,
        # with, for and while, but not function or class bodies.
        for node in body:
            yield node
            if isinstance(node, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.With, ast.AsyncWith)):
                yield from module_level(node.body)
                yield from module_level(getattr(node, "orelse", []))
            elif isinstance(node, ast.Try) or type(node).__name__ == "TryStar":
                yield from module_level(node.body)
                for h in node.handlers:
                    yield from module_level(h.body)
                yield from module_level(node.orelse)
                yield from module_level(node.finalbody)
    for node in module_level(tree.body):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            out["bound"].append(node.name)
            if node.name == "__getattr__":
                out["open"] = True
        elif isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for t in targets:
                for n in ast.walk(t):
                    if isinstance(n, ast.Name):
                        out["bound"].append(n.id)
                        if n.id == "__all__" and isinstance(node, ast.Assign) and isinstance(node.value, (ast.List, ast.Tuple)):
                            values = [e.value for e in node.value.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)]
                            if len(values) == len(node.value.elts):
                                out["all"] = values
        elif isinstance(node, ast.Import):
            out["bound"] += [(a.asname or a.name.split(".")[0]) for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            if node.level > 0:
                out["reexports"] = True
            for a in node.names:
                if a.name == "*":
                    out["open"] = True
                else:
                    out["bound"].append(a.asname or a.name)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                out["imports"].append({"module": a.name, "level": 0, "names": [], "line": node.lineno, "from": False})
        elif isinstance(node, ast.ImportFrom):
            names = [a.name for a in node.names if a.name != "*"]
            out["imports"].append({"module": node.module or "", "level": node.level, "names": names, "line": node.lineno, "from": True})
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and "/" in node.value and len(node.value) < 300 and "\n" not in node.value:
            out["literals"].append({"text": node.value, "line": node.lineno})
    return out

paths = json.load(sys.stdin)
json.dump([parse(p) for p in paths], sys.stdout)
`;

type Module = { path: string; file: string | null; folder: string | null };

export function analyze(repo: Repo): { analysis: Analysis; literals: Command[] } {
  const code = [...repo.files].filter((f) => f.endsWith(".py"));
  if (code.length === 0) return { analysis: { edges: [], boundaries: [], unverifiable: [] }, literals: [] };
  let parsed: Parsed[];
  try {
    const out = execFileSync("python3", ["-c", READER], { input: JSON.stringify(code), encoding: "utf8", maxBuffer: 1 << 30, cwd: repo.root });
    parsed = JSON.parse(out) as Parsed[];
  } catch (error) {
    const why = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return {
      analysis: { edges: [], boundaries: [], unverifiable: [{ path: code[0], reason: `python3 could not read the ${code.length} Python files: ${why}` }] },
      literals: [],
    };
  }
  const byPath = new Map(parsed.map((p) => [p.path, p]));
  const edges: Edge[] = [];
  const unverifiable: Unverifiable[] = [];
  const literals: Command[] = [];
  const roots = importRoots(repo);
  const boundaries: Boundary[] = [];
  for (const p of parsed) {
    if (paths.name(p.path) === "__init__.py" && (p.all !== null || p.reexports)) {
      boundaries.push({ folder: paths.dir(p.path), entry: p.path });
    }
  }
  const interfaces = new Map(boundaries.map((b) => [b.folder, byPath.get(b.entry)!]));

  for (const p of parsed) {
    if (p.error) {
      unverifiable.push({ path: p.path, line: p.line, reason: p.error });
      continue;
    }
    literals.push(...p.literals.map((l) => ({ file: p.path, line: l.line, text: l.text })));
    for (const imp of p.imports) {
      const targets = imp.from && imp.names.length > 0 ? imp.names.map((n) => [n]) : [[]];
      for (const name of targets) {
        const result = resolveImport(repo, roots, byPath, interfaces, p.path, imp.module, imp.level, name[0]);
        if (result === "external") continue;
        if ("reason" in result) unverifiable.push({ path: p.path, line: imp.line, reason: result.reason });
        else edges.push({ from: p.path, to: result.to, kind: "import", line: imp.line, items: result.items, bypass: result.bypass });
      }
    }
  }
  return { analysis: { edges, boundaries, unverifiable }, literals };
}

/** Folders absolute imports may start from, besides the importer's own. */
function importRoots(repo: Repo): string[] {
  const roots = new Set([""]);
  for (const file of repo.files) {
    if (!["pyproject.toml", "setup.py", "setup.cfg"].includes(paths.name(file))) continue;
    roots.add(paths.dir(file));
    const src = paths.join(paths.dir(file), "src");
    if (repo.folders.has(src)) roots.add(src);
  }
  return [...roots];
}

function moduleAt(repo: Repo, base: string, segments: string[]): Module | null {
  const stem = segments.reduce((at, s) => paths.join(at, s), base);
  if (repo.files.has(`${stem}.py`)) return { path: segments.join("."), file: `${stem}.py`, folder: null };
  if (repo.folders.has(stem) && stem !== base) {
    const init = paths.join(stem, "__init__.py");
    return { path: segments.join("."), file: repo.files.has(init) ? init : null, folder: stem };
  }
  return null;
}

/** Resolves `from <module> import <name>` (or `import <module>`), relative to
 * `level` packages above the importer, walking boundaries on the way. */
function resolveImport(
  repo: Repo,
  roots: string[],
  byPath: Map<string, Parsed>,
  interfaces: Map<string, Parsed>,
  importer: string,
  module: string,
  level: number,
  name: string | undefined,
): { to: string; items: string[]; bypass?: Edge["bypass"] } | "external" | { reason: string } {
  const segments = module === "" ? [] : module.split(".");
  const written = name !== undefined || level > 0 ? `from ${".".repeat(level)}${module} import ${name ?? "…"}` : `import ${module}`;
  let bases: string[];
  if (level > 0) {
    let base = paths.dir(importer);
    for (let i = 1; i < level; i++) {
      if (base === "") return { reason: `\`${written}\` goes above the repository` };
      base = paths.dir(base);
    }
    bases = [base];
  } else {
    // A script run directly has its own folder first on sys.path; a module
    // of a package (its folder holds __init__.py) does not.
    const first = segments[0];
    const script = !repo.files.has(paths.join(paths.dir(importer), "__init__.py"));
    bases = [...(script ? [paths.dir(importer)] : []), ...roots].filter((b, i, all) => all.indexOf(b) === i && moduleAt(repo, b, [first]) !== null);
    if (bases.length === 0) return "external";
  }
  // The first base where the whole module path exists, as Python's search
  // would find it; a project folder named like its package is not the package.
  // As Python's import system: a module or regular package (with __init__.py)
  // on any search path wins over a namespace folder of the same name.
  const regular = (b: string) => {
    const top = moduleAt(repo, b, [segments[0]]);
    return top !== null && (top.folder === null || top.file !== null);
  };
  const complete = (b: string) => segments.length === 0 || moduleAt(repo, b, segments) !== null;
  const base = bases.find((b) => regular(b) && complete(b)) ?? bases.find(complete) ?? bases[0];
  // Walk the modules the import names, then the imported name.
  const chain: Module[] = [];
  for (let i = 1; i <= segments.length; i++) {
    const m = moduleAt(repo, base, segments.slice(0, i));
    if (!m) return { reason: `\`${written}\`: no module ${segments.slice(0, i).join(".")} in ${base === "" ? "the repository root" : `${base}/`}` };
    chain.push(m);
  }
  let items: string[] = [];
  if (name !== undefined) {
    const packageFolder = level > 0 && segments.length === 0 ? base : chain.at(-1)?.folder ?? null;
    const sub = packageFolder !== null ? moduleAt(repo, packageFolder, [name]) : null;
    if (sub && packageFolder !== null) chain.push(sub);
    else {
      const holder = level > 0 && segments.length === 0 ? paths.join(base, "__init__.py") : chain.at(-1)?.file;
      const parsed = holder ? byPath.get(holder) : undefined;
      if (!parsed || !(parsed.open || parsed.bound.includes(name) || parsed.all?.includes(name))) {
        return { reason: `\`${written}\`: ${name} is neither a module nor a name ${holder ?? "the package"} defines` };
      }
      items = [name];
    }
  }
  // The first boundary the import enters from outside must export the next step.
  for (let i = 0; i < chain.length; i++) {
    const m = chain[i];
    if (m.folder === null || paths.within(importer, m.folder)) continue;
    const face = interfaces.get(m.folder);
    if (!face) continue;
    const next = i + 1 < chain.length ? chain[i + 1].path.split(".").at(-1)! : items[0];
    if (next === undefined) return { to: face.path, items: [] };
    const exported = face.open || (face.all ?? face.bound).includes(next);
    if (exported) return { to: face.path, items: [next] };
    return { to: chain.at(-1)!.file ?? chain.at(-1)!.folder!, items, bypass: { boundary: m.folder, entry: face.path } };
  }
  const last = chain.at(-1);
  if (!last) return { to: paths.join(base, "__init__.py"), items };
  return { to: last.file ?? last.folder!, items };
}
