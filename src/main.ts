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
import { type Analysis, merge } from "./graph";
import * as python from "./python";
import * as references from "./references";
import { load, type Repo } from "./repo";
import * as rust from "./rust";
import { suggestReport, verifyReport } from "./sarif";
import { judge } from "./suggest";
import * as typescript from "./typescript";
import { verify } from "./verify";

export async function analyze(repo: Repo): Promise<Analysis> {
  const ts = typescript.analyze(repo);
  const py = python.analyze(repo);
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
  const analysis = await analyze(repo);
  if (mode === "suggest") {
    const judgments = judge(repo, analysis);
    process.stdout.write(`${JSON.stringify(suggestReport(judgments, pkg.version))}\n`);
    return judgments.some((j) => j.probability > 0.7) ? 1 : 0;
  }
  const verdict = verify(repo, analysis);
  process.stdout.write(`${JSON.stringify(verifyReport(verdict, pkg.version))}\n`);
  const lines = [
    `reqfile-colocation: ${verdict.compliant.length} compliant, ${verdict.violations.length} violations, ${verdict.unverifiable.length} unverifiable, ${verdict.excepted.length} excepted`,
    ...verdict.unverifiable.map((u) => `unverifiable  ${u.path}${u.line ? `:${u.line}` : ""}  ${u.reason}`),
    ...verdict.violations.map((v) => `violation     ${v.path}${v.line ? `:${v.line}` : ""}  [${v.rule}] ${v.message}`),
    ...verdict.excepted.map((v) => `excepted      ${v.path}  [${v.rule}] ${v.reason}`),
  ];
  process.stderr.write(`${lines.join("\n")}\n`);
  if (verdict.unverifiable.length > 0) return 2;
  return verdict.violations.length > 0 ? 1 : 0;
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
