// What a path alone says about a file: its language, whether it is a test,
// and the name a test shares with its subject.

import * as paths from "./paths";

export type Lang = "script" | "python" | "rust" | "style";

const LANGS: Record<string, Lang> = {
  ts: "script", tsx: "script", js: "script", jsx: "script", mjs: "script", cjs: "script", mts: "script", cts: "script",
  py: "python",
  rs: "rust",
  css: "style", scss: "style", sass: "style", less: "style",
};

export function lang(path: string): Lang | undefined {
  const name = paths.name(path);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? undefined : LANGS[name.slice(dot + 1)];
}

export function isTest(path: string): boolean {
  const name = paths.name(path);
  return (
    name.includes(".test.") ||
    name.includes(".spec.") ||
    (name.startsWith("test_") && name.endsWith(".py")) ||
    name.endsWith("_test.py") ||
    paths.dir(path).split("/").some((part) => part === "tests" || part === "test" || part === "__tests__")
  );
}

/** `discount` for `discount.test.ts`, `issue` for `test_issue.py`. */
export function stem(path: string): string {
  let base = paths.name(path).split(".")[0];
  if (base.startsWith("test_")) base = base.slice(5);
  if (base.endsWith("_test")) base = base.slice(0, -5);
  return base.toLowerCase();
}

/** Code a tool writes, such as TanStack Router's routeTree.gen.ts or a
 * __generated__/ SDK: its layout is the tool's, not a design choice. */
export function generated(path: string, text: string): boolean {
  return (
    /\.(gen|generated)\.[a-z]+$/.test(paths.name(path)) ||
    /(^|\/)(__generated__|generated)\//.test(path) ||
    /@generated|auto-?generated|do not edit/i.test(text.slice(0, 400))
  );
}

/** Repository-level files: at the root but not code, or in the folders of
 * CI and tools. They use features; they never make a feature belong at the
 * root. */
export function consumer(path: string): boolean {
  if (/^\.(github|claude|gitlab|circleci|devcontainer|husky|vscode)\//.test(path)) return true;
  return paths.dir(path) === "" && lang(path) === undefined;
}

const MANIFESTS = new Set(["package.json", "Cargo.toml", "pyproject.toml", "setup.py", "setup.cfg"]);

export function manifest(path: string): boolean {
  return MANIFESTS.has(paths.name(path));
}
