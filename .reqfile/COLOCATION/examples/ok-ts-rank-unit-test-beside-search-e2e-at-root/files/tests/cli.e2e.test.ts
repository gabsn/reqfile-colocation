import { expect, test } from "bun:test";

test("the CLI prints matching note ids, best first", () => {
  const run = Bun.spawnSync(["bun", "src/cli.ts", "coffee", "grinder"]);
  expect(run.stdout.toString().trim().split("\n")).toEqual(["travel", "groceries"]);
});
