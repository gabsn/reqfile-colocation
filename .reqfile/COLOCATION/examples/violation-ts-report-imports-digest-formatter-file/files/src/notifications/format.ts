export function formatDigest(items: string[]): string {
  if (items.length === 0) return "Nothing new.";
  return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
}
