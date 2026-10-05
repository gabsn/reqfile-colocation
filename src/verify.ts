// The blocking rules: each is a fact about the resolved dependency graph, so a
// finding is true by construction, and nothing is judged from a file's name
// or a probability. What the analyses could not resolve makes the run
// unverifiable instead of passing.

import type { Analysis, Edge, Unverifiable } from "./graph";
import * as paths from "./paths";
import type { Config, Repo } from "./repo";
import { type Command, named, runBlocks } from "./references";
import * as source from "./source";

export type Rule = "interface" | "owner" | "tests" | "entry" | "roots";

export type Violation = { path: string; line?: number; rule: Rule; message: string };

export type Verdict = {
  /** Files the rules judged and found fine. */
  compliant: string[];
  violations: Violation[];
  /** Violations an exception accepts, with its reason. */
  excepted: (Violation & { reason: string })[];
  unverifiable: Unverifiable[];
};

/** Lines of shell a workflow step may hold before it is a feature's logic. */
const ENTRY_LINES = 5;

export function verify(repo: Repo, analysis: Analysis): Verdict {
  const { edges } = analysis;
  const violations: Violation[] = [
    ...interfaceRule(repo, edges),
    ...ownerRule(repo, edges),
    ...testsRule(repo, edges),
    ...entryRule(repo),
    ...rootsRule(repo, edges, repo.config),
  ];
  const unverifiable = [...analysis.unverifiable, ...declaredButMissing(repo, repo.config)];
  const excepted: Verdict["excepted"] = [];
  const kept: Violation[] = [];
  const used = new Set<number>();
  for (const v of violations) {
    const i = repo.config.exceptions.findIndex((x) => x.rule === v.rule && glob(x.path).test(v.path));
    if (i < 0) kept.push(v);
    else {
      used.add(i);
      excepted.push({ ...v, reason: repo.config.exceptions[i].reason });
    }
  }
  repo.config.exceptions.forEach((x, i) => {
    if (!used.has(i)) unverifiable.push({ path: "colocation.yaml", reason: `exception ${x.rule} on ${x.path} matches no finding; remove it` });
  });
  const flagged = new Set([...kept, ...excepted].map((v) => v.path));
  const judged = new Set(edges.flatMap((e) => [e.from, e.to]).filter((p) => repo.files.has(p)));
  return {
    compliant: [...judged].filter((p) => !flagged.has(p)).sort(),
    violations: dedupe(kept),
    excepted,
    unverifiable,
  };
}

/** interface: a dependency entering a boundary lands on its interface. The
 * language analyses decide each bypass (TS index files, Python package
 * interfaces; Rust has none, rustc enforces it). Tests are judged by where
 * they live, not by what they import. */
function interfaceRule(repo: Repo, edges: Edge[]): Violation[] {
  return edges
    .filter((e) => e.bypass && !source.isTest(e.from) && !source.consumer(e.from))
    .map((e) => ({
      path: e.from,
      line: e.line,
      rule: "interface" as const,
      message: `imports ${relativeTo(e.bypass!.boundary, e.to)} past the interface of ${e.bypass!.boundary}/ (${paths.name(e.bypass!.entry)}); import what ${paths.name(e.bypass!.entry)} exports, or export it there`,
    }));
}

/** Where a dependency's user is: the folder of the file that imports or names
 * it; for a path written in a repository-level file (CI, task file), the
 * folder of the other paths the same command names, or nowhere. */
function userFolder(e: Edge, repo: Repo): string | null {
  if (!source.consumer(e.from)) return paths.dir(e.from);
  const work = (e.via ?? []).filter((v) => !source.consumer(v));
  if (work.length === 0) return null;
  return paths.commonFolder(work.map((v) => (repo.folders.has(v) ? v : paths.dir(v))));
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

/** For each test, the folder of the code it tests: the common folder of its
 * subjects, or of their package when it tests only entry points, a whole
 * program run end to end. */
function homesOfTests(repo: Repo, edges: Edge[]): Map<string, string> {
  const importers = new Map<string, Edge[]>();
  for (const e of edges) importers.set(e.to, [...(importers.get(e.to) ?? []), e]);
  const homes = new Map<string, string>();
  const tests = new Set(edges.map((e) => e.from).filter((f) => source.isTest(f) && source.lang(f) !== undefined));
  for (const test of tests) {
    const imported = [
      ...new Set(edges.filter((e) => e.from === test && !source.isTest(e.to) && repo.files.has(e.to) && source.lang(e.to) !== undefined).map((e) => e.to)),
    ];
    // Its subject: the file it is named after, else the code it imports that
    // is not test support (fixtures only tests use), else whatever it imports.
    const named = imported.filter((f) => source.stem(f) === source.stem(test));
    const support = (f: string) => (importers.get(f) ?? []).every((e) => source.isTest(e.from));
    const production = imported.filter((f) => !support(f));
    const subjects = named.length > 0 ? named : production.length > 0 ? production : imported;
    if (subjects.length === 0) continue;
    const whole = subjects.every((s) => isEntry(repo, s, importers.get(s) ?? []));
    homes.set(test, whole ? packageOf(repo, subjects[0]) : paths.commonFolder(subjects.map(paths.dir)));
  }
  return homes;
}

/** tests: a test lives in the folder of the code it tests, unless a tool
 * requires its place (Rust tests/, benches/, examples/ next to Cargo.toml). */
function testsRule(repo: Repo, edges: Edge[]): Violation[] {
  const out: Violation[] = [];
  for (const [test, home] of homesOfTests(repo, edges)) {
    if (toolRequired(repo, test) || paths.within(test, home)) continue;
    out.push({ path: test, rule: "tests", message: `tests code in ${orRoot(home)}/ from outside it; move it into ${orRoot(home)}/` });
  }
  return out;
}

/** entry: a workflow step, in the folder GitHub requires, stays a thin entry
 * point: several lines of shell working on the repository's folders are
 * their logic, which belongs in a script there. */
function entryRule(repo: Repo): Violation[] {
  const out: Violation[] = [];
  for (const file of [...repo.files].filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f))) {
    for (const block of runBlocks(repo.read(file))) {
      const lines = block.text.split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
      if (lines.length < ENTRY_LINES) continue;
      const command: Command = { file, line: block.line, text: block.text };
      const folders = [...new Set(named(repo, command).filter((p) => p.includes("/") || repo.folders.has(p)).map((p) => p.split("/")[0]))];
      if (folders.length === 0) continue;
      out.push({
        path: file,
        line: block.line,
        rule: "entry",
        message: `a step runs ${lines.length} lines of shell on ${folders.map((f) => `${f}/`).join(", ")}; move them into a script there and call it`,
      });
    }
  }
  return out;
}

/** roots: under a root declared in colocation.yaml, a file directly in it
 * that several of its features use is either declared shared or moved into
 * the one feature it belongs to. Which files form one feature is not in the
 * code; this declaration is what makes it checkable. */
function rootsRule(repo: Repo, edges: Edge[], config: Config): Violation[] {
  const out: Violation[] = [];
  for (const root of config.roots) {
    const unit = (file: string) => {
      const rest = root.path === "" ? file : file.slice(root.path.length + 1);
      return paths.join(root.path, rest.split("/")[0]);
    };
    for (const file of [...repo.files].filter((f) => paths.dir(f) === root.path && source.lang(f) !== undefined && !source.isTest(f))) {
      if (root.shared.includes(file)) continue;
      const users = [
        ...new Set(edges.filter((e) => e.to === file && paths.within(e.from, root.path) && !source.isTest(e.from)).map((e) => unit(e.from))),
      ].filter((u) => u !== file);
      if (users.length < 2) continue;
      out.push({
        path: file,
        rule: "roots",
        message: `is used by ${users.length} features of ${orRoot(root.path)}/ (${users.map((u) => relativeTo(root.path, u)).join(", ")}): move it into the one it belongs to, or list it under shared in colocation.yaml`,
      });
    }
  }
  return out;
}

function declaredButMissing(repo: Repo, config: Config): Unverifiable[] {
  const out: Unverifiable[] = [];
  for (const root of config.roots) {
    if (!repo.folders.has(root.path)) out.push({ path: "colocation.yaml", reason: `root ${root.path} is not a folder of the repository` });
    for (const shared of root.shared) {
      if (!repo.files.has(shared)) out.push({ path: "colocation.yaml", reason: `shared ${shared} is not a file of the repository` });
    }
  }
  return out;
}

/** A program something runs: a Rust binary root, a Python __main__ module or
 * script with a main guard, a file with a shebang, or one a manifest, task or
 * workflow command runs. */
function isEntry(repo: Repo, file: string, importers: Edge[]): boolean {
  if (/(^|\/)src\/(main\.rs|bin\/)|(^|\/)build\.rs$/.test(file) || paths.name(file) === "__main__.py") return true;
  if (importers.some((e) => e.kind === "path" && (source.consumer(e.from) || source.lang(e.from) === undefined))) return true;
  if (source.lang(file) === undefined) return false;
  const text = repo.read(file);
  return text.startsWith("#!") || (file.endsWith(".py") && /^if __name__ == ["']__main__["']\s*:/m.test(text));
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

function rootFolders(repo: Repo): Set<string> {
  const roots = new Set(["", ...repo.config.roots.map((r) => r.path)]);
  for (const file of repo.files) {
    if (!source.manifest(file)) continue;
    roots.add(paths.dir(file));
    roots.add(paths.join(paths.dir(file), "src"));
  }
  return roots;
}

/** Places a tool or convention fixes: migrations, Rust tests/, benches/,
 * examples/ next to Cargo.toml, agent configuration, and the documents a
 * folder keeps about itself. */
function toolRequired(repo: Repo, path: string): boolean {
  const parts = path.split("/");
  if (/^\.(agents|claude|codex|cursor|github)\//.test(path)) return true;
  if (/^(AGENTS|CLAUDE|README|LICENSE|CHANGELOG|CONTRIBUTING)(\..*)?$/i.test(paths.name(path))) return true;
  return parts.some(
    (part, i) =>
      part === "migrations" ||
      (["tests", "benches", "examples"].includes(part) && repo.files.has(paths.join(parts.slice(0, i).join("/"), "Cargo.toml"))),
  );
}

function isCrateRoot(repo: Repo, path: string): boolean {
  const m = path.match(/^(.*?)\/?src\/(lib|main)\.rs$/);
  return m !== null && repo.files.has(paths.join(m[1], "Cargo.toml"));
}

function packageOf(repo: Repo, file: string): string {
  for (let dir = paths.dir(file); ; dir = paths.dir(dir)) {
    if ([...repo.files].some((f) => source.manifest(f) && paths.dir(f) === dir)) return dir;
    if (dir === "") return "";
  }
}

function manifestOf(repo: Repo, folder: string): string | undefined {
  return [...repo.files].find((f) => source.manifest(f) && paths.dir(f) === folder);
}

function glob(pattern: string): RegExp {
  const re = pattern
    .split("**")
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]"))
    .join(".*");
  return new RegExp(`^${re}$`);
}

function dedupe(violations: Violation[]): Violation[] {
  const seen = new Map<string, Violation>();
  for (const v of violations) {
    const key = `${v.path}\0${v.rule}\0${v.message}`;
    if (!seen.has(key)) seen.set(key, v);
  }
  return [...seen.values()];
}

function relativeTo(folder: string, path: string): string {
  return folder !== "" && path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;
}

function orRoot(folder: string): string {
  return folder === "" ? "." : folder;
}
