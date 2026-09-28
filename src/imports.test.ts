import { expect, test } from "bun:test";
import { python, rust, script } from "./imports";

test("script: named, default and side-effect imports", () => {
  const text =
    'import Money, { formatCents, type Cents as C } from "../money";\nimport "./Avatar.css";\nimport { x } from "react";\n';
  expect(script(text)).toEqual([
    { module: "../money", items: ["formatCents", "Cents", "default"] },
    { module: "./Avatar.css", items: [] },
  ]);
});

test("python: from and plain imports", () => {
  const text = "from crm.models.invoice import Invoice, Line as L\nimport os.path\nfrom . import (a,\n  b)\n";
  expect(python(text)).toEqual([
    { module: "crm.models.invoice", items: ["Invoice", "Line"] },
    { module: ".", items: ["a", "b"] },
    { module: "os.path", items: [] },
  ]);
});

test("rust: use trees are expanded, not read as whole-module uses", () => {
  const paths = rust("use crate::constants::{MAX_RETRIES, http::{Client as C, self}};");
  expect(paths).toContainEqual(["crate", "constants", "MAX_RETRIES"]);
  expect(paths).toContainEqual(["crate", "constants", "http", "Client"]);
  expect(paths).toContainEqual(["crate", "constants", "http", "self"]);
  expect(paths).not.toContainEqual(["crate", "constants"]);
});
