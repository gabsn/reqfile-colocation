// Where things are, shared by the blocking and the advisory checks: who
// uses a dependency and from where, what runs, what a tool places, where the
// roots and packages are, and the folder of the code a test tests.

import type { Edge } from "./graph";
import * as paths from "./paths";
import type { Repo } from "./repo";
import * as source from "./source";

export /** Where a dependency's user is: the folder of the file that imports or names
 * it; for a path written in a repository-level file (CI, task file), the
 * folder of the other paths the same command names, or nowhere. */
function userFolder(e: Edge, repo: Repo): string | null {
  if (!source.consumer(e.from)) return paths.dir(e.from);
  const work = (e.via ?? []).filter((v) => !source.consumer(v));
  if (work.length === 0) return null;
  return paths.commonFolder(work.map((v) => (repo.folders.has(v) ? v : paths.dir(v))));
}

export /** For each test, the folder of the code it tests: the common folder of its
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

export /** A program something runs: a Rust binary root, a Python __main__ module or
 * script with a main guard, a file with a shebang, or one a manifest, task or
 * workflow command runs. */
function isEntry(repo: Repo, file: string, importers: Edge[]): boolean {
  if (/(^|\/)src\/(main\.rs|bin\/)|(^|\/)build\.rs$/.test(file) || paths.name(file) === "__main__.py") return true;
  if (importers.some((e) => e.kind === "path" && (source.consumer(e.from) || source.lang(e.from) === undefined))) return true;
  if (source.lang(file) === undefined) return false;
  const text = repo.read(file);
  return text.startsWith("#!") || (file.endsWith(".py") && /^if __name__ == ["']__main__["']\s*:/m.test(text));
}

export function rootFolders(repo: Repo): Set<string> {
  const roots = new Set(["", ...repo.config.roots.map((r) => r.path)]);
  for (const file of repo.files) {
    if (!source.manifest(file)) continue;
    roots.add(paths.dir(file));
    roots.add(paths.join(paths.dir(file), "src"));
  }
  return roots;
}

export /** Places a tool or convention fixes: migrations, Rust tests/, benches/,
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

export function isCrateRoot(repo: Repo, path: string): boolean {
  const m = path.match(/^(.*?)\/?src\/(lib|main)\.rs$/);
  return m !== null && repo.files.has(paths.join(m[1], "Cargo.toml"));
}

export function packageOf(repo: Repo, file: string): string {
  for (let dir = paths.dir(file); ; dir = paths.dir(dir)) {
    if ([...repo.files].some((f) => source.manifest(f) && paths.dir(f) === dir)) return dir;
    if (dir === "") return "";
  }
}

export function manifestOf(repo: Repo, folder: string): string | undefined {
  return [...repo.files].find((f) => source.manifest(f) && paths.dir(f) === folder);
}

export function relativeTo(folder: string, path: string): string {
  return folder !== "" && path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;
}

export function orRoot(folder: string): string {
  return folder === "" ? "." : folder;
}
