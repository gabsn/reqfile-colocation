#!/usr/bin/env node
// reqfile-colocation: reads the repository in the current folder and prints
// a SARIF report of where files live relative to the code that uses them.
// Exit 0 when nothing fails, 1 when something does, 2 when it cannot run.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import pkg from "../package.json";
import * as paths from "./paths";
import { type Alias, edges, type Project } from "./resolve";
import { judge } from "./rules";
import { failed, report } from "./sarif";
import * as source from "./source";

/** The files git would track, minus hidden folders such as .reqfile/. */
function listFiles(): Set<string> {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  return new Set(out.split("\0").filter((p) => p !== "" && !p.split("/").some((part) => part.startsWith("."))));
}

/** The GitHub Actions workflows, which listFiles leaves out with every hidden folder. */
function listWorkflows(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ".github/workflows"], {
    encoding: "utf8",
  });
  return out.split("\0").filter((p) => /\.ya?ml$/.test(p));
}

function load(): Project {
  const files = listFiles();
  const read = (path: string) => readFileSync(path, "utf8");
  const sources = new Map<string, string>();
  for (const path of files) if (source.lang(path)) sources.set(path, read(path));
  const crates = new Map<string, string>();
  for (const manifest of [...files].filter((p) => paths.name(p) === "Cargo.toml")) {
    const name = read(manifest).match(/^name\s*=\s*"([^"]+)"/m);
    if (name) crates.set(paths.dir(manifest), name[1]);
  }
  const pythonRoots = new Set([""]);
  for (const manifest of [...files].filter((p) => ["pyproject.toml", "setup.py"].includes(paths.name(p)))) {
    pythonRoots.add(paths.dir(manifest));
    pythonRoots.add(paths.join(paths.dir(manifest), "src"));
  }
  const aliases = new Map<string, Alias[]>();
  for (const config of [...files].filter((p) => ["tsconfig.json", "jsconfig.json"].includes(paths.name(p)))) {
    try {
      aliases.set(paths.dir(config), tsAliases(paths.dir(config), read(config)));
    } catch (error) {
      throw new Error(`${config}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const workflows = new Map(listWorkflows().map((path) => [path, read(path)]));
  return { files, sources, crates, pythonRoots: [...pythonRoots], aliases, workflows };
}

/** The `compilerOptions.paths` of a tsconfig, as repository paths. JSON with
 * comments and trailing commas, as TypeScript accepts it. */
function tsAliases(dir: string, text: string): Alias[] {
  const json = text.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, s) => s ?? "").replace(/,(\s*[}\]])/g, "$1");
  const options = (JSON.parse(json) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }).compilerOptions ?? {};
  const base = paths.join(dir, options.baseUrl ?? ".");
  return Object.entries(options.paths ?? {}).map(([pattern, targets]) => ({
    prefix: pattern.replace(/\*$/, ""),
    exact: !pattern.endsWith("*"),
    targets: targets.map((t) => paths.join(base, t)),
  }));
}

function main(): number {
  if (process.argv.includes("--version")) {
    console.log(`reqfile-colocation ${pkg.version}`);
    return 0;
  }
  let project: Project;
  try {
    project = load();
  } catch (error) {
    console.error(`reqfile-colocation: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const judgments = judge(project.files, project.sources, edges(project), new Set(project.crates.keys()), project.workflows);
  process.stdout.write(`${JSON.stringify(report(judgments, pkg.version))}\n`);
  return judgments.some(failed) ? 1 : 0;
}

process.exitCode = main();
