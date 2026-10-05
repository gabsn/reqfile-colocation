import { expect, test } from "bun:test";
import { edges, type Project } from "./resolve";

function project(sources: Record<string, string>, aliases: Project["aliases"]): Project {
  return { files: new Set(Object.keys(sources)), sources: new Map(Object.entries(sources)), crates: new Map(), pythonRoots: [""], aliases };
}

test("an import through a tsconfig path alias resolves to the file it names", () => {
  const found = edges(project(
    { "src/billing/invoice.ts": 'import { format } from "@/utils/format";\nimport React from "react";\n', "src/utils/format.ts": "" },
    new Map([["", [{ prefix: "@/", exact: false, targets: ["./src/*"] }]]]),
  ));
  expect(found).toEqual([{ from: "src/billing/invoice.ts", to: "src/utils/format.ts", items: ["format"] }]);
});
