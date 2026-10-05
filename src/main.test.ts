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
  });
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("src/tax.rs  [owner] only billing.rs uses tax.rs");
});

test("a package referenced by path only from another top-level folder belongs beside its user", () => {
  const r = run({
    "oss/widget/Cargo.toml": '[package]\nname = "widget"\nversion = "0.1.0"\nedition = "2021"\n',
    "oss/widget/src/lib.rs": "pub fn score() -> u32 {\n    1\n}\n",
    "widget/evals/run.py": 'import subprocess\n\nsubprocess.run(["cargo", "test", "--manifest-path", "oss/widget/Cargo.toml"], check=True)\n',
  });
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("oss/widget/Cargo.toml  [owner] oss/widget/ is used only from widget/evals/");
});

test("a workflow step running a feature's logic inline breaks the entry rule; a call into its folder does not", () => {
  const thick = "jobs:\n  e:\n    steps:\n      - run: |\n          cd widget\n          make build\n          ./bin/widget a > before\n          ./bin/widget b > after\n          python3 widget/score.py before after\n";
  const files = { "widget/score.py": "print(1)\n", "widget/regression.sh": "python3 score.py\n" };
  expect(run({ ...files, ".github/workflows/e.yml": thick }).stderr).toContain("[entry]");
  expect(run({ ...files, ".github/workflows/e.yml": "jobs:\n  e:\n    steps:\n      - run: widget/regression.sh\n" }).code).toBe(0);
});

test("an exception accepts a finding with its reason; one that matches nothing is an error", () => {
  const files = {
    "Cargo.toml": CARGO,
    "src/main.rs": "mod billing;\nmod tax;\n\nfn main() {\n    println!(\"{}\", billing::total(1));\n}\n",
    "src/billing.rs": "pub fn total(n: u32) -> u32 {\n    n + crate::tax::rate(n)\n}\n",
    "src/tax.rs": "pub fn rate(n: u32) -> u32 {\n    n / 5\n}\n",
  };
  const accepted = run({ ...files, "colocation.yaml": "exceptions:\n  - path: src/tax.rs\n    rule: owner\n    reason: generated by build.rs\n" });
  expect(accepted.code).toBe(0);
  expect(accepted.stderr).toContain("excepted      src/tax.rs  [owner] generated by build.rs");
  expect(accepted.sarif).toContain('"status":"accepted"');
  const stale = run({ ...files, "src/tax.rs": "", "src/billing.rs": "pub fn total(n: u32) -> u32 {\n    n\n}\n", "colocation.yaml": "exceptions:\n  - path: src/tax.rs\n    rule: owner\n    reason: old\n" });
  expect(stale.code).toBe(2);
  expect(stale.stderr).toContain("matches no finding");
});

test("colocation.yaml is strict: an unknown key fails the run", () => {
  const r = run({ "colocation.yaml": "root:\n  - path: src\n", "a.py": "print(1)\n" });
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("unknown key `root`");
});
