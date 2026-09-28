// The SARIF report reqfile reads: a fail result per file that likely breaks
// COLOCATION, a pass result per file judged fine, each with its probability.

import type { Judgment } from "./rules";

/** At or above this probability a judgment is reported as a failure. */
const FAIL_FROM = 0.5;

export function failed(judgment: Judgment): boolean {
  return judgment.probability >= FAIL_FROM;
}

export function report(judgments: Judgment[], version: string): object {
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: { driver: { name: "reqfile-colocation", version, rules: [{ id: "COLOCATION" }] } },
        results: judgments.map((j) => ({
          ruleId: "COLOCATION",
          kind: failed(j) ? "fail" : "pass",
          level: failed(j) ? "error" : "none",
          message: { text: j.message },
          locations: [
            { physicalLocation: { artifactLocation: { uri: j.path }, region: { startLine: 1 } } },
          ],
          properties: { probability: j.probability },
        })),
      },
    ],
  };
}
