#!/usr/bin/env node
// reqfile-colocation: reads the repository in the current folder and prints a
// SARIF report on stdout, a summary on stderr.
//
//   reqfile-colocation [verify]   the blocking rules. Exit 0: every file
//                                 verified, nothing broken. 1: violations, all
//                                 else verified. 2: something could not be
//                                 verified (listed), or the run failed.
//   reqfile-colocation suggest    the advisory heuristics, with probabilities.
//                                 Exit 0, or 1 when a finding is likely.

import pkg from "../package.json";
import * as cache from "./cache";
import { type Analysis, merge } from "./graph";
import * as python from "./python";
import * as references from "./references";
import { load, type Repo } from "./repo";
import * as rust from "./rust";
import { suggestReport, verifyReport } from "./sarif";
import { judge } from "./suggest";
import * as typescript from "./typescript";
import { verify } from "./verify";

export async function analyze(repo: Repo, files: cache.Cache): Promise<Analysis> {
  const ts = typescript.analyze(repo, files);
  const py = python.analyze(repo, files);
  const rs = await rust.analyze(repo);
  const paths = references.edges(repo, references.commands(repo, [...ts.literals, ...py.literals]));
  return merge([ts.analysis, py.analysis, rs, { edges: paths, boundaries: [], unverifiable: [] }]);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--version")) {
    console.log(`reqfile-colocation ${pkg.version}`);
    return 0;
  }
  const mode = args[0] ?? "verify";
  if (!["verify", "suggest"].includes(mode)) {
    console.error(`reqfile-colocation: unknown command \`${mode}\`; expected verify or suggest`);
    return 2;
  }
  const repo = load();
  const files = cache.open(repo, pkg.version);
  const earlier = files.result();
  const output = earlier?.outputs[mode];
  if (output) return print(output);
  const analysis = earlier?.analysis ?? (await analyze(repo, files));
  // Stored as analyzed, before the rules read it.
  const stored: Analysis = earlier ? analysis : JSON.parse(JSON.stringify(analysis));
  const fresh = report(repo, analysis, mode);
  files.save(stored, mode, fresh);
  return print(fresh);
}

function print(output: cache.Output): number {
  process.stdout.write(output.stdout);
  process.stderr.write(output.stderr);
  return output.code;
}

function report(repo: Repo, analysis: Analysis, mode: string): cache.Output {
  if (mode === "suggest") {
    const judgments = judge(repo, analysis);
    return {
      stdout: `${JSON.stringify(suggestReport(judgments, pkg.version))}\n`,
      stderr: "",
      code: judgments.some((j) => j.probability > 0.7) ? 1 : 0,
    };
  }
  const verdict = verify(repo, analysis);
  const lines = [
    `reqfile-colocation: ${verdict.compliant.length} compliant, ${verdict.violations.length} violations, ${verdict.unverifiable.length} unverifiable, ${verdict.excepted.length} excepted`,
    ...verdict.unverifiable.map((u) => `unverifiable  ${u.path}${u.line ? `:${u.line}` : ""}  ${u.reason}`),
    ...verdict.violations.map((v) => `violation     ${v.path}${v.line ? `:${v.line}` : ""}  [${v.rule}] ${v.message}`),
    ...verdict.excepted.map((v) => `excepted      ${v.path}  [${v.rule}] ${v.reason}`),
  ];
  return {
    stdout: `${JSON.stringify(verifyReport(verdict, pkg.version))}\n`,
    stderr: `${lines.join("\n")}\n`,
    code: verdict.unverifiable.length > 0 ? 2 : verdict.violations.length > 0 ? 1 : 0,
  };
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`reqfile-colocation: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  },
);
