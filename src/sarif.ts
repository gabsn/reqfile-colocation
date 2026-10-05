// The SARIF reports reqfile reads. verify: one fail result per violation,
// carrying its rule, one pass result per compliant file, and accepted
// exceptions as suppressed results with their reason. suggest: one result per
// judged file with the probability of a placement problem.

import type { Judgment } from "./suggest";
import type { Verdict, Violation } from "./verify";

type Result = Record<string, unknown>;

function location(path: string, line?: number) {
  return [{ physicalLocation: { artifactLocation: { uri: path }, ...(line ? { region: { startLine: line } } : {}) } }];
}

function run(version: string, results: Result[], rules: string[]) {
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "reqfile-colocation",
            version,
            informationUri: "https://github.com/gabsn/reqfile-colocation",
            rules: rules.map((id) => ({ id })),
          },
        },
        results,
      },
    ],
  };
}

const violation = (v: Violation): Result => ({
  ruleId: `COLOCATION/${v.rule}`,
  kind: "fail",
  level: "error",
  message: { text: v.message },
  locations: location(v.path, v.line),
});

export function verifyReport(verdict: Verdict, version: string) {
  const results: Result[] = [
    ...verdict.violations.map(violation),
    ...verdict.excepted.map((v) => ({
      ...violation(v),
      suppressions: [{ kind: "external", status: "accepted", justification: v.reason }],
    })),
    ...verdict.compliant.map((path) => ({
      ruleId: "COLOCATION",
      kind: "pass",
      level: "none",
      message: { text: "every rule checked, none broken" },
      locations: location(path),
    })),
  ];
  return run(version, results, ["COLOCATION", ...["interface", "owner", "tests", "entry", "roots"].map((r) => `COLOCATION/${r}`)]);
}

export function suggestReport(judgments: Judgment[], version: string) {
  const results: Result[] = judgments.map((j) => ({
    ruleId: "COLOCATION/suggest",
    kind: j.probability > 0.5 ? "fail" : "pass",
    level: j.probability > 0.5 ? "warning" : "none",
    message: { text: j.message },
    locations: location(j.path),
    properties: { probability: j.probability },
  }));
  return run(version, results, ["COLOCATION/suggest"]);
}
