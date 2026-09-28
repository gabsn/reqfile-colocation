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
