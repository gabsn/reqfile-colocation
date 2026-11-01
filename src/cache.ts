// The cache that makes a second run cheap, in `$REQFILE_CACHE/colocation`
// (else `$XDG_CACHE_HOME/reqfile/colocation`, else
// `~/.cache/reqfile/colocation`), like reqfile's own cache.
//
// Two levels, both keyed on content, so a stale entry is never read:
// - facts: what one file says on its own (its imports, its path literals, its
//   parse error), keyed by its git blob hash and how it is parsed. An edited
//   file is parsed again; the others are not.
// - results: the whole analysis, and each mode's report, keyed on the tool's
//   version, the repository's folder and every file with its blob hash. Module
//   resolution also reads what git does not list (node_modules, ignored build
//   output, a tsconfig extended from a package): every such probe is recorded
//   with its answer, and a result is reused only if each probe still answers
//   the same. `verify` then `suggest` on the same tree share one analysis.
//
// The cache is only ever a shortcut: an entry that is missing, unreadable or
// from another version is recomputed, and a cache that cannot be written is
// skipped.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import type TS from "typescript";

import type { Analysis } from "./graph";
import type { Repo } from "./repo";

/** Bumped when what is cached changes shape or meaning. */
const FORMAT = 1;
/** Results kept, newest first: a few branches and worktrees. */
const RESULTS = 32;
/** Facts kept per kind, most recently written first. */
const FACTS = 200_000;

/** One mode's report, as printed. */
export type Output = { stdout: string; stderr: string; code: number };

type Result = { probes: Probe[]; analysis: Analysis; outputs: Record<string, Output> };

/** A question asked of the file system, with its answer. */
type Probe = [kind: ProbeKind, path: string, answer: string];
type ProbeKind = "file" | "dir" | "read" | "real" | "dirs" | "exists";

export type Cache = {
  /** A fact about one file, computed once per content. */
  fact<T>(kind: string, path: string, compute: () => T, keep?: (value: T) => boolean): T;
  /** Several facts at once, computing the missing ones together. */
  facts<T>(kind: string, files: string[], compute: (missing: string[]) => T[], keep?: (value: T) => boolean): T[];
  /** The file system as module resolution sees it, every probe outside the
   * listed files recorded. */
  host: TS.ModuleResolutionHost & TS.ParseConfigFileHost;
  /** `existsSync`, recorded the same way. */
  exists(absolute: string): boolean;
  /** The result of an earlier run on the same tree, if its probes still hold. */
  result(): { analysis: Analysis; outputs: Record<string, Output> } | undefined;
  /** Stores this run's analysis and one mode's report, and the new facts. */
  save(analysis: Analysis, mode: string, output: Output): void;
};

export function directory(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const set = (key: string) => (env[key] ? env[key] : undefined);
  const base = set("REQFILE_CACHE") ?? (set("XDG_CACHE_HOME") ? join(set("XDG_CACHE_HOME")!, "reqfile") : undefined);
  if (base) return join(base, "colocation");
  const home = set("HOME") ?? homedir();
  return home ? join(home, ".cache", "reqfile", "colocation") : undefined;
}

const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

/** Git's blob hash of a file's bytes, as `git ls-files -s` prints it. */
export function blobHash(bytes: Buffer): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/** The blob hash of every listed file: the index's for files the working tree
 * has unchanged, the file's own bytes for modified and untracked ones. */
export function blobs(repo: Repo): Map<string, string> {
  const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 30 });
  const out = new Map<string, string>();
  const prefix = git(["rev-parse", "--show-prefix"]).trim();
  for (const entry of git(["ls-files", "-s", "-z"]).split("\0")) {
    const m = entry.match(/^\d+ ([0-9a-f]+) \d\t(.*)$/s);
    if (m && repo.files.has(m[2])) out.set(m[2], m[1]);
  }
  // Files whose working copy differs from the index (` M`, ` D`, ` T`...) or
  // that git does not track (`??`). `git status` refreshes the index's stat
  // data, so the next run compares only what changed.
  const changed = git(["status", "--porcelain", "-z", "--no-renames", "--untracked-files=all", "--ignore-submodules=none"])
    .split("\0")
    .filter((e) => e.length > 3 && (e[1] !== " " || e.startsWith("??")))
    // Its paths are from the repository's top, the listed files from here.
    .map((e) => e.slice(3))
    .filter((p) => p.startsWith(prefix))
    .map((p) => p.slice(prefix.length));
  const own = (path: string) => {
    try {
      out.set(path, blobHash(readFileSync(join(repo.root, path))));
    } catch {
      // Deleted, or not a file: what the analysis will meet when reading it.
      out.set(path, "missing");
    }
  };
  for (const path of changed) if (repo.files.has(path)) own(path);
  // Anything else git listed (none expected) is hashed from its bytes too.
  for (const path of repo.files) if (!out.has(path)) own(path);
  return out;
}

/** TypeScript, loaded only when something is analyzed: a run answered from
 * the cache does not pay for its 9 MB. */
export function typescript(): typeof TS {
  return require("typescript") as typeof TS;
}

const require = createRequire(import.meta.url);

export function open(repo: Repo, version: string, dir = directory()): Cache {
  const hashes = blobs(repo);
  const tsVersion = (require("typescript/package.json") as { version: string }).version;
  const python = [...repo.files].some((f) => f.endsWith(".py")) ? pythonVersion() : "";
  const files = [...hashes].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const key = sha(JSON.stringify({ format: FORMAT, version, typescript: tsVersion, python, root: repo.root, files }));
  const salt = `${FORMAT}\0${version}\0${tsVersion}\0${python}`;

  const packs = new Map<string, { entries: Map<string, unknown>; added: boolean }>();
  const pack = (kind: string) => {
    let p = packs.get(kind);
    if (!p) {
      p = { entries: new Map(Object.entries(readJson<Record<string, unknown>>(dir && join(dir, `facts-${kind}.json`)) ?? {})), added: false };
      packs.set(kind, p);
    }
    return p;
  };
  /** A file's fact key: its content, and its name, which can change how it
   * parses (`.d.ts`, `.tsx`). */
  const factKey = (path: string) => {
    const blob = hashes.get(path);
    return blob === undefined || blob === "missing" ? undefined : sha(`${salt}\0${name(path)}\0${blob}`);
  };
  const facts = <T>(kind: string, paths: string[], compute: (missing: string[]) => T[], keep = (_: T) => true): T[] => {
    const p = pack(kind);
    const out: (T | undefined)[] = paths.map((path) => {
      const k = factKey(path);
      return k === undefined ? undefined : (p.entries.get(k) as T | undefined);
    });
    const missing = paths.filter((_, i) => out[i] === undefined);
    if (missing.length > 0) {
      const computed = compute(missing);
      let j = 0;
      for (let i = 0; i < paths.length; i++) {
        if (out[i] !== undefined) continue;
        const value = computed[j++];
        out[i] = value;
        const k = factKey(paths[i]);
        if (k !== undefined && keep(value)) {
          p.entries.delete(k);
          p.entries.set(k, value);
          p.added = true;
        }
      }
    }
    return out as T[];
  };

  const probes = new Map<string, Probe>();
  const listed = (absolute: string) => {
    const rel = relative(repo.root, absolute).split("\\").join("/");
    if (rel === "" || rel.startsWith("../") || isAbsolute(rel)) return rel === "";
    return repo.files.has(rel) || repo.folders.has(rel);
  };
  const record = <T>(kind: ProbeKind, path: string, answer: T, encode: (a: T) => string): T => {
    const id = `${kind}\0${path}`;
    if (!probes.has(id)) probes.set(id, [kind, path, encode(answer)]);
    return answer;
  };
  const bool = (b: boolean) => (b ? "1" : "0");
  const text = (t: string | undefined) => (t === undefined ? "" : `=${sha(t)}`);
  // The file system as TypeScript's own `ts.sys` reads it, answering module
  // resolution and the check of a stored result alike.
  const ask: Record<ProbeKind, (path: string) => string> = {
    file: (p) => bool(fs.fileExists(p)),
    dir: (p) => bool(fs.directoryExists(p)),
    read: (p) => text(fs.readFile(p)),
    real: (p) => fs.realpath(p),
    dirs: (p) => JSON.stringify(fs.getDirectories(p)),
    exists: (p) => bool(existsAt(p)),
  };
  const host: Cache["host"] = {
    fileExists: (p) => (listed(p) ? fs.fileExists(p) : record("file", p, fs.fileExists(p), bool)),
    directoryExists: (p) => (listed(p) ? fs.directoryExists(p) : record("dir", p, fs.directoryExists(p), bool)),
    readFile: (p) => (listed(p) ? fs.readFile(p) : record("read", p, fs.readFile(p), text)),
    realpath: (p) => record("real", p, fs.realpath(p), (r) => r),
    getDirectories: (p) => record("dirs", p, fs.getDirectories(p), (d) => JSON.stringify(d)),
    getCurrentDirectory: () => process.cwd(),
    get useCaseSensitiveFileNames() {
      return typescript().sys.useCaseSensitiveFileNames;
    },
    // Only the config's file list, which nothing here reads.
    readDirectory: (...args) => typescript().sys.readDirectory(...args),
    onUnRecoverableConfigFileDiagnostic: () => {},
  };

  const resultPath = dir && join(dir, "results", `${key}.json`);
  let reused: Result | undefined;
  return {
    fact: (kind, path, compute, keep) => facts(kind, [path], () => [compute()], keep)[0],
    facts,
    host,
    exists: (p) => (listed(p) ? existsAt(p) : record("exists", p, existsAt(p), bool)),
    result() {
      const r = readJson<Result>(resultPath);
      if (!r || !Array.isArray(r.probes) || !r.analysis || typeof r.outputs !== "object") return undefined;
      for (const [kind, path, answer] of r.probes) {
        const fresh = (() => {
          try {
            return ask[kind]?.(path);
          } catch {
            // A probe that now throws answers differently.
            return undefined;
          }
        })();
        if (fresh !== answer) return undefined;
      }
      reused = r;
      return { analysis: r.analysis, outputs: r.outputs };
    },
    save(analysis, mode, output) {
      if (!dir) return;
      try {
        mkdirSync(join(dir, "results"), { recursive: true });
        for (const [kind, p] of packs) {
          if (!p.added) continue;
          const kept = [...p.entries].slice(-FACTS);
          writeAtomic(join(dir, `facts-${kind}.json`), JSON.stringify(Object.fromEntries(kept)));
        }
        // Another process (the other mode) may have stored its report since.
        const latest = readJson<Result>(resultPath) ?? reused;
        const base: Result = reused ?? { probes: [...probes.values()], analysis, outputs: {} };
        const outputs = { ...(latest?.outputs ?? {}), ...base.outputs, [mode]: output };
        writeAtomic(resultPath!, JSON.stringify({ ...base, outputs }));
        prune(join(dir, "results"));
      } catch {
        // A cache that cannot be written only makes the next run slower.
      }
    },
  };
}

/** TypeScript's `ts.sys` file system calls (typescript.js, `createSystem`),
 * so answers are the same without loading TypeScript. */
const fs = {
  stat(path: string) {
    try {
      return statSync(path, { throwIfNoEntry: false });
    } catch {
      // Unreadable: not there, as ts.sys answers.
      return undefined;
    }
  },
  fileExists: (path: string) => fs.stat(path)?.isFile() ?? false,
  directoryExists: (path: string) => fs.stat(path)?.isDirectory() ?? false,
  readFile(path: string): string | undefined {
    let buffer: Buffer;
    try {
      buffer = readFileSync(path);
    } catch {
      // Missing or unreadable: undefined, as ts.sys answers.
      return undefined;
    }
    const len = buffer.length;
    if (len >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
      const swapped = Buffer.from(buffer.subarray(0, len & ~1));
      swapped.swap16();
      return swapped.toString("utf16le", 2);
    }
    if (len >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString("utf16le", 2);
    if (len >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.toString("utf8", 3);
    return buffer.toString("utf8");
  },
  realpath(path: string): string {
    try {
      return (realpathSync.native ?? realpathSync)(path);
    } catch {
      // ts.sys answers the path itself.
      return path;
    }
  },
  getDirectories(path: string): string[] {
    const out: string[] = [];
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(path || ".", { withFileTypes: true });
    } catch {
      // ts.sys lists nothing.
      return [];
    }
    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") continue;
      const stat = entry.isSymbolicLink() ? fs.stat(join(path, entry.name)) : entry;
      if (stat?.isDirectory()) out.push(entry.name);
    }
    return out.sort();
  },
};

function existsAt(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function name(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function pythonVersion(): string {
  try {
    return execFileSync("python3", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    // No python3: the analysis reports it, and nothing Python is cached.
    return "none";
  }
}

function readJson<T>(path: string | undefined): T | undefined {
  if (!path) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    // Missing or torn: a miss.
    return undefined;
  }
}

function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function prune(folder: string): void {
  const entries = readdirSync(folder)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return { f, t: statSync(join(folder, f)).mtimeMs };
      } catch {
        // Removed by another run meanwhile.
        return { f, t: -1 };
      }
    })
    .filter((e) => e.t >= 0)
    .sort((a, b) => b.t - a.t);
  for (const { f } of entries.slice(RESULTS)) {
    try {
      unlinkSync(join(folder, f));
    } catch {
      // Already gone.
    }
  }
}
