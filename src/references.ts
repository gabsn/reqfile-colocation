// Dependencies no import shows: paths written in workflow steps, shell
// scripts, package.json scripts, task files (mise.toml, Makefile, justfile),
// manifests (`path = ...`), and string literals of Python and TS/JS code. A
// path counts when it names a file or folder of the repository, from the
// repository root or from the writing file's folder; a manifest stands for
// its whole package folder. Paths one command names together are linked by
// `via`: a command that runs src/changelog/ with templates/changelog.md says
// the template serves the changelog.

import type { Edge } from "./graph";
import * as paths from "./paths";
import type { Repo } from "./repo";
import * as source from "./source";

/** One command, script line or literal, with where it is written. */
export type Command = { file: string; line: number; text: string };

const TASK_FILES = new Set(["mise.toml", ".mise.toml", "Makefile", "makefile", "justfile", "Justfile"]);
/** Files that tell a platform what to run: containers, process lists, workers. */
const RUNNERS = /^(Dockerfile(\..+)?|.+\.Dockerfile|Procfile|docker-compose\.ya?ml|compose\.ya?ml|wrangler\.(toml|jsonc?)|vercel\.json|netlify\.toml|fly\.toml)$/;

export function commands(repo: Repo, literals: Command[]): Command[] {
  const found: Command[] = [...literals];
  for (const file of repo.files) {
    const name = paths.name(file);
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)) {
      for (const block of runBlocks(repo.read(file))) found.push(...lines(file, block.text, block.line));
    } else if (/\.(sh|bash)$/.test(name) || TASK_FILES.has(name) || RUNNERS.test(name)) {
      found.push(...lines(file, repo.read(file), 1));
    } else if (name === "package.json") {
      found.push(...packageScripts(file, repo.read(file)));
    } else if (name === "Cargo.toml" || name === "pyproject.toml") {
      repo.read(file).split("\n").forEach((text, i) => {
        const m = text.match(/\bpath\s*=\s*"([^"]+)"/);
        if (m) found.push({ file, line: i + 1, text: m[1] });
      });
    }
  }
  return found;
}

/** Shell lines, continuations joined, comments dropped. */
function lines(file: string, text: string, first: number): Command[] {
  const out: Command[] = [];
  let pending = "";
  let start = first;
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/(^|\s)#.*$/, "").trimEnd();
    if (pending === "") start = first + i;
    if (line.endsWith("\\")) {
      pending += `${line.slice(0, -1)} `;
      return;
    }
    const whole = pending + line;
    pending = "";
    if (whole.trim() !== "") out.push({ file, line: start, text: whole });
  });
  return out;
}

function packageScripts(file: string, text: string): Command[] {
  let scripts: unknown;
  try {
    scripts = (JSON.parse(text) as { scripts?: unknown }).scripts;
  } catch {
    // An unreadable package.json is reported by the TypeScript analysis
    // when it matters for resolution; here it only has no scripts.
    return [];
  }
  const all = text.split("\n");
  const doc = JSON.parse(text) as { bin?: unknown; main?: unknown; exports?: unknown; module?: unknown };
  const runs = [doc.main, doc.module, ...strings(doc.bin), ...strings(doc.exports)];
  const declared = typeof scripts === "object" && scripts !== null ? Object.values(scripts as Record<string, unknown>) : [];
  return [...declared, ...runs]
    .filter((v): v is string => typeof v === "string")
    .map((value) => ({ file, line: all.findIndex((l) => l.includes(JSON.stringify(value).slice(1, -1))) + 1 || 1, text: value }));
}

/** Every string inside a JSON value: the targets of `bin` or `exports` maps. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

/** The scripts of a workflow's `run:` keys: a one-line value, or a `|` / `>`
 * block, whose lines are those indented deeper than the key. */
export function runBlocks(text: string): { line: number; text: string }[] {
  const all = text.split("\n");
  const blocks: { line: number; text: string }[] = [];
  all.forEach((line, i) => {
    const m = line.match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!m) return;
    const value = m[2].trim();
    if (!/^[|>][-+]?$/.test(value)) {
      if (value !== "") blocks.push({ line: i + 1, text: value });
      return;
    }
    const indent = line.length - line.trimStart().length;
    const body: string[] = [];
    for (const next of all.slice(i + 1)) {
      if (next.trim() !== "" && next.length - next.trimStart().length <= indent) break;
      body.push(next);
    }
    blocks.push({ line: i + 2, text: body.join("\n") });
  });
  return blocks;
}

/** The repository paths a command names: files, folders, or for a manifest,
 * its package folder. */
export function named(repo: Repo, command: Command): string[] {
  const found = new Set<string>();
  for (let token of command.text.split(/[\s"'`=,;(){}[\]<>|&]+/)) {
    if (!token.includes("/") || token.includes("://") || /[*?]/.test(token)) continue;
    token = token.replace(/[:.]+$/, "");
    const relative: string[] = [];
    const variable = token.match(/^\$\{?\w+\}?\/(.*)$/);
    if (variable) relative.push(variable[1]);
    else relative.push(token);
    for (const rel of relative) {
      const candidates = [paths.normalize(rel), paths.normalize(paths.join(paths.dir(command.file), rel))];
      for (const c of candidates) {
        if (c === null || c === "" || c === command.file) continue;
        if (repo.files.has(c)) {
          found.add(source.manifest(c) && paths.dir(c) !== "" ? paths.dir(c) : outerPackage(repo, c, command.file) ?? c);
          break;
        }
        if (repo.folders.has(c)) {
          found.add(c);
          break;
        }
      }
    }
  }
  return [...found];
}

/** The package (a folder with its manifest, not the repository root) holding
 * `file`, when `from` is outside it: a path into another package depends on
 * that package, the unit that ships and moves. */
function outerPackage(repo: Repo, file: string, from: string): string | undefined {
  for (let dir = paths.dir(file); dir !== ""; dir = paths.dir(dir)) {
    if (paths.within(from, dir)) return undefined;
    for (const m of ["package.json", "Cargo.toml", "pyproject.toml", "setup.py"]) if (repo.files.has(paths.join(dir, m))) return dir;
  }
  return undefined;
}

export function edges(repo: Repo, all: Command[]): Edge[] {
  const out: Edge[] = [];
  for (const command of all) {
    const refs = named(repo, command);
    for (const to of refs) {
      out.push({ from: command.file, to, kind: "path", line: command.line, items: [], via: refs.filter((r) => r !== to) });
    }
  }
  return out;
}
