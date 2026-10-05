import { expect, test } from "bun:test";
import type { Edge } from "./resolve";
import { judge } from "./rules";

const index = 'import { taxFor } from "./tax";\nexport function invoiceTotal(n: number): number { return n + taxFor(n); }\n';

function flagged(sources: Record<string, string>, edges: Edge[], crates: string[] = []): string[] {
  const files = new Set(Object.keys(sources));
  return judge(files, new Map(Object.entries(sources)), edges, new Set(crates))
    .filter((j) => j.probability > 0.7)
    .map((j) => `${j.path}: ${j.message}`);
}

test("an import past a folder's interface is flagged on the importer", () => {
  const sources = { "src/billing/index.ts": index, "src/billing/tax.ts": "export const taxFor = (n: number) => n;\n", "src/cart/checkout.ts": "", "src/main.ts": "" };
  const edges: Edge[] = [
    { from: "src/billing/index.ts", to: "src/billing/tax.ts", items: ["taxFor"] },
    { from: "src/cart/checkout.ts", to: "src/billing/tax.ts", items: ["taxFor"] },
    { from: "src/main.ts", to: "src/billing/index.ts", items: ["invoiceTotal"] },
    { from: "src/main.ts", to: "src/cart/checkout.ts", items: [] },
  ];
  expect(flagged(sources, edges)).toEqual([
    "src/cart/checkout.ts: reaches into src/billing/ past its interface index.ts (imports tax.ts)",
  ]);
});

test("an import through the interface, or into a folder without one, is not", () => {
  const sources = { "src/billing/index.ts": index, "src/billing/tax.ts": "", "src/money/format.ts": "", "src/cart/checkout.ts": "", "src/main.ts": "" };
  const edges: Edge[] = [
    { from: "src/billing/index.ts", to: "src/billing/tax.ts", items: ["taxFor"] },
    { from: "src/cart/checkout.ts", to: "src/billing/index.ts", items: ["invoiceTotal"] },
    { from: "src/main.ts", to: "src/billing/index.ts", items: ["invoiceTotal"] },
    { from: "src/cart/checkout.ts", to: "src/money/format.ts", items: [] },
    { from: "src/main.ts", to: "src/money/format.ts", items: [] },
    { from: "src/main.ts", to: "src/cart/checkout.ts", items: [] },
  ];
  expect(flagged(sources, edges)).toEqual([]);
});

test("a Rust path naming a private submodule is a re-exported item, not a reach past the interface", () => {
  const sources = {
    "src/main.rs": "mod pins;\nfn main() { pins::add(); }\n",
    "src/pins/mod.rs": "mod add;\npub use add::run as add;\n",
    "src/pins/add.rs": "pub fn run() {}\n",
  };
  const edges: Edge[] = [
    { from: "src/main.rs", to: "src/pins/add.rs", items: [] },
    { from: "src/main.rs", to: "src/pins/mod.rs", items: [] },
    { from: "src/pins/mod.rs", to: "src/pins/add.rs", items: ["run"] },
  ];
  expect(flagged(sources, edges, [""]).filter((f) => f.includes("past its interface"))).toEqual([]);
});

test("an item whose users all live elsewhere is flagged; inside a module, grouping is free", () => {
  const money = "export function formatMoney(c: number): string { return `${c}`; }\n\nexport function invoiceTotal(l: number[]): number { return l.length; }\n";
  const types = "export type Address = { city: string };\n\nexport type PaymentMethod = { kind: string };\n";
  const sources = {
    "package.json": "{}", "src/money.ts": money, "src/billing/invoice.ts": "", "src/cart/summary.ts": "",
    "src/checkout/types.ts": types, "src/checkout/payment.ts": "", "src/checkout/shipping.ts": "",
  };
  const edges: Edge[] = [
    { from: "src/billing/invoice.ts", to: "src/money.ts", items: ["formatMoney", "invoiceTotal"] },
    { from: "src/cart/summary.ts", to: "src/money.ts", items: ["formatMoney"] },
    { from: "src/checkout/payment.ts", to: "src/checkout/types.ts", items: ["PaymentMethod"] },
    { from: "src/checkout/shipping.ts", to: "src/checkout/types.ts", items: ["Address"] },
  ];
  expect(flagged(sources, edges)).toEqual(["src/money.ts: invoiceTotal serves only src/billing/"]);
});
