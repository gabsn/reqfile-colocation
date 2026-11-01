// The cache never changes a report: after any change to the repository, a run
// on a warm cache prints exactly what a run on an empty cache prints. Each
// test changes one kind of input and checks the warm run saw it.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { blobHash, directory } from "./cache";

const MAIN = join(import.meta.dir, "main.ts");

type Run = { code: number | null; stdout: string; stderr: string };

function repo(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "colocation-cache-repo-"));
  const cache = mkdtempSync(join(tmpdir(), "colocation-cache-"));
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  for (const [path, text] of Object.entries(files)) write(path, text);
  spawnSync("git", ["init", "-q"], { cwd: dir });
  const run = (mode: string, at: string): Run => {
    const out = spawnSync("bun", [MAIN, mode], { cwd: dir, encoding: "utf8", env: { ...process.env, REQFILE_CACHE: at } });
    return { code: out.status, stdout: out.stdout, stderr: out.stderr };
  };
  return {
    dir,
    cache,
    write,
    remove: (path: string) => rmSync(join(dir, path), { recursive: true }),
    git: (...args: string[]) => spawnSync("git", ["-c", "user.email=a@example.com", "-c", "user.name=A", ...args], { cwd: dir }),
    /** A run on the shared cache, checked against one on an empty cache. */
    check(mode = "verify"): Run {
      const warm = run(mode, cache);
      const cold = run(mode, mkdtempSync(join(tmpdir(), "colocation-cold-")));
      expect(warm).toEqual(cold);
      return warm;
    },
    results: () => readdirSync(join(cache, "colocation", "results")),
  };
}

const BASE = {
  "package.json": '{ "name": "shop" }',
  "src/billing/index.ts": 'export { total } from "./tax";\n',
  "src/billing/tax.ts": "export const total = (n: number) => n * 1.2;\n",
  "src/main.ts": 'import { total } from "./billing";\nconsole.log(total(2));\n',
};

test("a second run on the same tree reuses the first's result, and verify and suggest share one analysis", () => {
  const r = repo(BASE);
  const first = r.check("verify");
  expect(first.code).toBe(0);
  expect(r.results()).toHaveLength(1);
  r.check("suggest");
  expect(r.results()).toHaveLength(1);
  const [entry] = r.results();
  const stored = JSON.parse(readFileSync(join(r.cache, "colocation", "results", entry), "utf8"));
  expect(Object.keys(stored.outputs).sort()).toEqual(["suggest", "verify"]);
  expect(r.check("verify")).toEqual(first);
});

test("an edited file is read again: a new bypass of an interface is caught on a warm cache", () => {
  const r = repo(BASE);
  expect(r.check().code).toBe(0);
  r.write("src/main.ts", 'import { total } from "./billing/tax";\nconsole.log(total(2));\n');
  const after = r.check();
  expect(after.code).toBe(1);
  expect(after.stderr).toContain("src/main.ts:1  [interface]");
});

test("an edit committed, then reverted in the working copy, is seen both times", () => {
  const r = repo(BASE);
  r.git("add", ".");
  r.git("commit", "-qm", "base");
  expect(r.check().code).toBe(0);
  r.write("src/main.ts", 'import { total } from "./billing/nope";\nconsole.log(total(2));\n');
  r.git("commit", "-qam", "broken");
  expect(r.check().code).toBe(2);
  r.write("src/main.ts", BASE["src/main.ts"]);
  expect(r.check().code).toBe(0);
});

test("a tsconfig change is seen: a paths alias added, then removed", () => {
  const r = repo({ ...BASE, "src/main.ts": 'import { total } from "@/billing";\nconsole.log(total(2));\n' });
  r.write("node_modules/.keep", "");
  r.write(".gitignore", "node_modules\n");
  expect(r.check().code).toBe(0);
  r.write("tsconfig.json", '{ "compilerOptions": { "paths": { "@/*": ["./src/nope/*"] } } }');
  const broken = r.check();
  expect(broken.code).toBe(2);
  expect(broken.stderr).toContain("matches a path alias but does not resolve");
  r.write("tsconfig.json", '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }');
  expect(r.check().code).toBe(0);
});

test("a package.json change is seen: a workspace package's exports moved past its interface", () => {
  const r = repo({
    "package.json": '{ "name": "root", "workspaces": ["packages/*"] }',
    "packages/money/package.json": '{ "name": "@acme/money", "exports": { ".": "./src/index.ts" } }',
    "packages/money/src/index.ts": 'export { cents } from "./cents";\n',
    "packages/money/src/cents.ts": "export const cents = (n: number) => n * 100;\n",
    "app/main.ts": 'import { cents } from "@acme/money";\nconsole.log(cents(1));\n',
  });
  expect(r.check().code).toBe(0);
  r.write("packages/money/package.json", '{ "name": "@acme/money", "exports": { ".": "./src/cents.ts" } }');
  const moved = r.check();
  expect(moved.code).toBe(1);
  expect(moved.stderr).toContain("app/main.ts:1  [interface]");
});

test("a new file is seen: a test placed away from its code", () => {
  const r = repo(BASE);
  const before = r.check();
  r.write("tests/tax.test.ts", 'import { total } from "../src/billing";\ntest("t", () => total(1));\n');
  const after = r.check();
  expect(after).not.toEqual(before);
  expect(after.stderr).toContain("tests/tax.test.ts");
});

test("a deleted file is seen: the import of it no longer resolves", () => {
  const r = repo(BASE);
  r.git("add", ".");
  expect(r.check().code).toBe(0);
  r.remove("src/billing/tax.ts");
  r.git("rm", "-q", "--cached", "src/billing/tax.ts");
  const after = r.check();
  expect(after.code).toBe(2);
  expect(after.stderr).toContain("does not resolve");
});

test("a file git ignores is probed again: build output appearing changes the result", () => {
  const r = repo({
    ...BASE,
    ".gitignore": "dist/\n",
    "src/main.ts": 'import { total } from "./billing";\nimport { built } from "../dist/out";\nconsole.log(total(2), built);\n',
  });
  const missing = r.check();
  expect(missing.stderr).toContain("does not resolve to a file");
  r.write("dist/out.ts", "export const built = 1;\n");
  const present = r.check();
  expect(present.stderr).toContain("which git does not track");
  r.remove("dist");
  expect(r.check()).toEqual(missing);
});

test("an installed package is probed again: a tsconfig extended from node_modules breaking, then fixed", () => {
  const r = repo({ ...BASE, ".gitignore": "node_modules\n", "tsconfig.json": '{ "extends": "@acme/tsconfig/base.json" }' });
  r.write("node_modules/@acme/tsconfig/package.json", '{ "name": "@acme/tsconfig" }');
  r.write("node_modules/@acme/tsconfig/base.json", '{ "compilerOptions": { "strict": true } }');
  expect(r.check().code).toBe(0);
  r.write("node_modules/@acme/tsconfig/base.json", "{ broken");
  const broken = r.check();
  expect(broken.code).toBe(2);
  expect(broken.stderr).toContain("tsconfig.json does not parse");
  r.write("node_modules/@acme/tsconfig/base.json", '{ "compilerOptions": { "strict": true } }');
  expect(r.check().code).toBe(0);
});

test("a Python file edited is parsed again", () => {
  const r = repo({
    "pyproject.toml": '[project]\nname = "shop"\n',
    "shop/__init__.py": "",
    "shop/tax.py": "def rate(n: int) -> int:\n    return n // 5\n",
    "shop/main.py": "from shop.tax import rate\n\nprint(rate(1))\n",
  });
  expect(r.check().code).toBe(0);
  r.write("shop/main.py", "from shop.nope import rate\n\nprint(rate(1)\n");
  const broken = r.check();
  expect(broken.code).toBe(2);
  expect(broken.stderr).toContain("shop/main.py");
});

test("the cache folder is REQFILE_CACHE's, else XDG_CACHE_HOME's, else HOME's", () => {
  expect(directory({ REQFILE_CACHE: "/c", XDG_CACHE_HOME: "/x", HOME: "/h" })).toBe(join("/c", "colocation"));
  expect(directory({ XDG_CACHE_HOME: "/x", HOME: "/h" })).toBe(join("/x", "reqfile", "colocation"));
  expect(directory({ HOME: "/h" })).toBe(join("/h", ".cache", "reqfile", "colocation"));
});

test("a blob hash is git's", () => {
  const dir = mkdtempSync(join(tmpdir(), "colocation-blob-"));
  writeFileSync(join(dir, "a.txt"), "hello\n");
  const git = spawnSync("git", ["hash-object", "a.txt"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  expect(blobHash(Buffer.from("hello\n"))).toBe(git);
});
