// The checker run as reqfile runs it, on throwaway repositories: what each
// language resolves, the three outcomes (compliant, violation, unverifiable)
// and their exit codes, exceptions and colocation.yaml.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const MAIN = join(import.meta.dir, "main.ts");
const CARGO = '[package]\nname = "shop"\nversion = "0.1.0"\nedition = "2021"\n';

function run(files: Record<string, string>, mode = "verify") {
  const dir = mkdtempSync(join(tmpdir(), "colocation-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  spawnSync("git", ["init", "-q"], { cwd: dir });
  const out = spawnSync("bun", [MAIN, mode], { cwd: dir, encoding: "utf8" });
  return { code: out.status, stderr: out.stderr, sarif: out.stdout };
}

test("a local import that resolves to nothing makes the run unverifiable, exit 2", () => {
  const r = run({ "package.json": "{}", "src/a.ts": 'import { b } from "./missing";\nexport const a = b;\n' });
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("unverifiable  src/a.ts:1");
  expect(r.stderr).toContain("does not resolve");
});

test("an alias inherited through tsconfig extends resolves; one that matches no file is unverifiable", () => {
  const base = {
    "package.json": "{}",
    "tsconfig.base.json": '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"] } } }',
    "tsconfig.json": '{ "extends": "./tsconfig.base.json" }',
    "src/utils/format.ts": "export const format = (n: number) => `${n}`;\n",
    "src/main.ts": 'import { format } from "@/utils/format";\nconsole.log(format(1));\n',
  };
  expect(run(base).code).toBe(0);
  const broken = run({ ...base, "src/main.ts": 'import { format } from "@/utils/nope";\nconsole.log(format(1));\n' });
  expect(broken.code).toBe(2);
  expect(broken.stderr).toContain("matches a path alias but does not resolve");
});

test("an alias prefix is matched whole: @/* does not capture @scope packages; an alias onto an asset resolves", () => {
  const r = run({
    "package.json": "{}",
    "tsconfig.json": '{ "compilerOptions": { "paths": { "@/*": ["./src/*"], "~/*": ["./src/*"] } } }',
    "src/styles/app.css": "body {}\n",
    "src/main.ts": 'import { thing } from "@tanstack/router";\nimport "~/styles/app.css";\nconsole.log(thing);\n',
  });
  expect(r.stderr).not.toContain("unverifiable  src/main.ts");
  expect(r.code).toBe(0);
});

test("TypeScript: importing a file inside a folder with an index, from outside, is an interface violation", () => {
  const files = {
    "package.json": "{}",
    "src/billing/index.ts": 'export { total } from "./tax";\n',
    "src/billing/tax.ts": "export const total = (n: number) => n * 1.2;\n",
    "src/cart.ts": 'import { total } from "./billing/tax";\nexport const pay = total(1);\n',
    "src/main.ts": 'import { total } from "./billing";\nimport { pay } from "./cart";\nconsole.log(total(2), pay);\n',
  };
  const r = run(files);
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("src/cart.ts:1  [interface]");
  expect(run({ ...files, "src/cart.ts": 'import { total } from "./billing";\nexport const pay = total(1);\n' }).code).toBe(0);
});

test("Python: a name the package re-exports goes through its interface; a submodule it does not export does not", () => {
  const files = (init: string) => ({
    "pyproject.toml": '[project]\nname = "shop"\n',
    "billing/__init__.py": init,
    "billing/tax.py": "def rate(n: int) -> int:\n    return n // 5\n",
    "billing/invoice.py": "from billing.tax import rate\n\n\ndef total(n: int) -> int:\n    return n + rate(n)\n",
    "app/__init__.py": "",
    "app/quote.py": "from billing import tax, total\n\nprint(tax.rate(1), total(1))\n",
    "reports/__init__.py": "",
    "reports/monthly.py": "from billing import total\n\nprint(total(2))\n",
  });
  expect(run(files('from . import tax\nfrom .invoice import total\n\n__all__ = ["tax", "total"]\n')).code).toBe(0);
  const bypass = run(files('from .invoice import total\n\n__all__ = ["total"]\n'));
  expect(bypass.code).toBe(1);
  expect(bypass.stderr).toContain("app/quote.py:1  [interface]");
});

test("Python: names bound under try or if at module level are defined", () => {
  const r = run({ "pkg/__init__.py": "", "pkg/a.py": "try:\n    import fast as impl\nexcept ImportError:\n    impl = None\nif impl:\n    MODE = 1\nelse:\n    MODE = 2\n", "main.py": "from pkg.a import MODE, impl\nprint(MODE, impl)\n" });
  expect(r.code).toBe(0);
});

test("Python: a name a repository package does not define, or a file that does not parse, is unverifiable", () => {
  const missing = run({ "pkg/__init__.py": "", "pkg/a.py": "X = 1\n", "main.py": "from pkg.a import Y\n" });
  expect(missing.code).toBe(2);
  expect(missing.stderr).toContain("Y is neither a module nor a name");
  const broken = run({ "main.py": "def f(:\n" });
  expect(broken.code).toBe(2);
  expect(broken.stderr).toContain("does not parse");
});

test("Rust: a module using its own pub submodule is not a bypass; `mod x;` without its file is unverifiable", () => {
  const files = {
    "Cargo.toml": CARGO,
    "src/main.rs": "mod billing;\n\nfn main() {\n    println!(\"{} {}\", billing::total(1), billing::tax::rate(1));\n}\n",
    "src/billing.rs": "pub mod tax;\n\npub fn total(n: u32) -> u32 {\n    n + tax::rate(n)\n}\n",
    "src/billing/tax.rs": "pub fn rate(n: u32) -> u32 {\n    n / 5\n}\n",
  };
  expect(run(files).code).toBe(0);
  const missing = run({ ...files, "src/main.rs": "mod billing;\nmod ledger;\n\nfn main() {}\n" });
  expect(missing.code).toBe(2);
  expect(missing.stderr).toContain("`mod ledger;` has no file");
});

test("Rust: paths inside macro arguments count as uses", () => {
  const r = run({
    "Cargo.toml": CARGO,
    "src/main.rs": "mod billing;\nmod tax;\n\nfn main() {\n    let line = billing::total(1);\n    println!(\"{line}\");\n}\n",
    "src/billing.rs": "pub fn total(n: u32) -> String {\n    format!(\"{} + {}\", n, crate::tax::rate(n))\n}\n",
    "src/tax.rs": "pub fn rate(n: u32) -> u32 {\n    n / 5\n}\n",
  }, "suggest");
  expect(r.sarif).toContain("only billing.rs uses tax.rs");
});

test("a product split by visibility, oss/widget/ used from widget/evals/, breaks the split rule", () => {
  const r = run({
    "oss/widget/Cargo.toml": '[package]\nname = "widget"\nversion = "0.1.0"\nedition = "2021"\n',
    "oss/widget/src/lib.rs": "pub fn score() -> u32 {\n    1\n}\n",
    "widget/evals/run.py": 'import subprocess\n\nsubprocess.run(["cargo", "test", "--manifest-path", "oss/widget/Cargo.toml"], check=True)\n',
  });
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("oss/widget/Cargo.toml  [split] feature `widget` is split between widget/ and oss/widget/");
  const together = run({
    "widget/oss/Cargo.toml": '[package]\nname = "widget"\nversion = "0.1.0"\nedition = "2021"\n',
    "widget/oss/src/lib.rs": "pub fn score() -> u32 {\n    1\n}\n",
    "widget/evals/run.py": 'import subprocess\n\nsubprocess.run(["cargo", "test", "--manifest-path", "widget/oss/Cargo.toml"], check=True)\n',
  });
  expect(together.code).toBe(0);
});

test("a workflow step running a feature's logic inline breaks the entry rule; a call into its folder does not", () => {
  const thick =
    "jobs:\n  e:\n    steps:\n      - run: |\n          cd widget\n          make build\n          ./bin/widget a > before\n          ./bin/widget b > after\n          python3 widget/score.py before after > score\n          grep -q pass score\n          cat score >> \"$GITHUB_STEP_SUMMARY\"\n          rm before after\n";
  const files = { "widget/score.py": "print(1)\n", "widget/regression.sh": "python3 score.py\n" };
  expect(run({ ...files, ".github/workflows/e.yml": thick }).stderr).toContain("[entry]");
  expect(run({ ...files, ".github/workflows/e.yml": "jobs:\n  e:\n    steps:\n      - run: widget/regression.sh\n" }).code).toBe(0);
});

test("an exception accepts a finding with its reason; one that matches nothing is an error", () => {
  const files = {
    "package.json": "{}",
    "src/rank.ts": "export const rank = (n: number) => n;\n",
    "src/main.ts": 'import { rank } from "./rank";\nconsole.log(rank(1));\n',
    "test/rank.test.ts": 'import { rank } from "../src/rank";\nif (rank(1) !== 1) throw new Error("rank");\n',
  };
  const exception = "exceptions:\n  - path: test/**\n    rule: tests\n    reason: the deployment image runs test/ only\n";
  const accepted = run({ ...files, "colocation.yaml": exception });
  expect(accepted.code).toBe(0);
  expect(accepted.stderr).toContain("excepted      test/rank.test.ts  [tests] the deployment image runs test/ only");
  expect(accepted.sarif).toContain('"status":"accepted"');
  const moved = { ...files, "test/rank.test.ts": undefined, "src/rank.test.ts": 'import { rank } from "./rank";\nif (rank(1) !== 1) throw new Error("rank");\n' };
  const stale = run({ ...Object.fromEntries(Object.entries(moved).filter(([, v]) => v !== undefined)) as Record<string, string>, "colocation.yaml": exception });
  expect(stale.code).toBe(2);
  expect(stale.stderr).toContain("matches no finding");
});

test("colocation.yaml is strict: an unknown key fails the run", () => {
  const r = run({ "colocation.yaml": "root:\n  - path: src\n", "a.py": "print(1)\n" });
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("unknown key `root`");
});

test("one feature in two tier folders, app/challenge and infra/challenge, breaks the split rule; distinct features do not", () => {
  const files = {
    "package.json": "{}",
    "src/app/challenge/score.ts": "export const score = (n: number) => n * 2;\n",
    "src/infra/challenge/handler.ts": 'import { score } from "../../app/challenge/score";\nexport const handle = () => score(1);\n',
    "src/main.ts": 'import { handle } from "./infra/challenge/handler";\nconsole.log(handle());\n',
  };
  const r = run(files);
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("[split] feature `challenge` is split between src/infra/challenge/ and src/app/challenge/");
  const apart = { ...files, "src/infra/challenge/handler.ts": undefined, "src/infra/gateway/handler.ts": 'import { score } from "../../app/challenge/score";\nexport const handle = () => score(1);\n', "src/main.ts": 'import { handle } from "./infra/gateway/handler";\nconsole.log(handle());\n' };
  expect(run(Object.fromEntries(Object.entries(apart).filter(([, v]) => v !== undefined)) as Record<string, string>).code).toBe(0);
});

test("interface: a package's own files reach their siblings past its root index; a test outside a module may not", () => {
  const pkg = {
    "evals/package.json": "{}",
    "evals/src/index.ts": 'export { run } from "./run";\nexport { agent } from "../agents/vapi";\n',
    "evals/src/run.ts": "export const run = () => 1;\n",
    "evals/agents/vapi.ts": 'import { run } from "../src/run";\nexport const agent = () => run();\n',
  };
  expect(run(pkg).code).toBe(0);
  const test = run({
    "package.json": "{}",
    "src/protocol/index.ts": 'export { encode } from "./codec";\n',
    "src/protocol/codec.ts": "export const encode = (s: string) => s;\n",
    "src/ws/client.ts": 'import { encode } from "../protocol";\nexport const send = (s: string) => encode(s);\n',
    "src/ws/client.test.ts": 'import { encode } from "../protocol/codec";\nimport { send } from "./client";\nif (send("a") !== encode("a")) throw new Error("x");\n',
  });
  expect(test.code).toBe(1);
  expect(test.stderr).toContain("src/ws/client.test.ts:1  [interface]");
});

test("a workspace package resolves by its package.json name without node_modules, and its interface applies", () => {
  const files = {
    "package.json": '{ "private": true, "workspaces": ["packages/*", "apps/*"] }',
    "packages/emails/package.json": '{ "name": "@acme/emails" }',
    "packages/emails/index.ts": 'export { render } from "./render";\n',
    "packages/emails/render.ts": "export const render = (s: string) => `<p>${s}</p>`;\n",
    "apps/worker/package.json": '{ "name": "worker" }',
    "apps/worker/src/digest.ts": 'import { render } from "@acme/emails/render";\nexport const digest = () => render("x");\n',
  };
  const deep = run(files);
  expect(deep.code).toBe(1);
  expect(deep.stderr).toContain("apps/worker/src/digest.ts:1  [interface]");
  expect(run({ ...files, "apps/worker/src/digest.ts": 'import { render } from "@acme/emails";\nexport const digest = () => render("x");\n' }).code).toBe(0);
});

test("a tool declared shared in colocation.yaml is not half of a feature named like it", () => {
  const files = {
    "platform/agent-evals/package.json": '{ "name": "@platform/agent-evals" }',
    "platform/agent-evals/src/index.ts": "export const runEvals = () => 1;\n",
    "voxrouter/agent-evals/e2e.ts": 'import { runEvals } from "@platform/agent-evals";\nconsole.log(runEvals());\n',
  };
  expect(run(files).stderr).toContain("[split]");
  expect(run({ ...files, "colocation.yaml": "shared: [platform/agent-evals]\n" }).code).toBe(0);
});
