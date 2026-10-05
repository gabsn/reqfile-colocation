// The blocking rules: each is a fact about the resolved dependency graph, so a
// finding is true by construction, and nothing is judged from a file's name
// or a probability. What the analyses could not resolve makes the run
// unverifiable instead of passing.

import type { Analysis, Edge, Unverifiable } from "./graph";
import * as paths from "./paths";
import type { Config, Repo } from "./repo";
import { type Command, named, runBlocks } from "./references";
import { homesOfTests, manifestOf, orRoot, relativeTo, toolRequired } from "./places";
import * as source from "./source";

export type Rule = "interface" | "tests" | "entry" | "split" | "roots" | "owner";

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
const ENTRY_LINES = 8;



export function verify(repo: Repo, analysis: Analysis): Verdict {
  const { edges } = analysis;
  const violations: Violation[] = [
    ...interfaceRule(repo, edges),
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
    .filter(
      (e) =>
        e.bypass &&
        !source.consumer(e.from) &&
        !packageInternal(repo, e.from, e.bypass.boundary),
    )
    .map((e) => ({
      path: e.from,
      line: e.line,
      rule: "interface" as const,
      message: `imports ${relativeTo(e.bypass!.boundary, e.to)} past the interface of ${e.bypass!.boundary}/ (${paths.name(e.bypass!.entry)}); import what ${paths.name(e.bypass!.entry)} exports, or export it there`,
    }));
}




/** A package's root interface (index at its root or its src/) is for other
 * packages: the package's own files reach their siblings directly. */
function packageInternal(repo: Repo, importer: string, boundary: string): boolean {
  const pkg = manifestOf(repo, boundary) ? boundary : paths.name(boundary) === "src" && manifestOf(repo, paths.dir(boundary)) ? paths.dir(boundary) : undefined;
  return pkg !== undefined && paths.within(importer, pkg);
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
  for (const shared of config.shared) {
    if (!repo.folders.has(shared) && !repo.files.has(shared)) out.push({ path: "colocation.yaml", reason: `shared ${shared} is not in the repository` });
  }
  for (const root of config.roots) {
    if (!repo.folders.has(root.path)) out.push({ path: "colocation.yaml", reason: `root ${root.path} is not a folder of the repository` });
    for (const shared of root.shared) {
      if (!repo.files.has(shared)) out.push({ path: "colocation.yaml", reason: `shared ${shared} is not a file of the repository` });
    }
  }
  return out;
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


