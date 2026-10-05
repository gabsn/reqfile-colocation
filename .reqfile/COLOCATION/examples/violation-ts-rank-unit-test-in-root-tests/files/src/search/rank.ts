export function score(queryTerms: string[], docTerms: string[]): number {
  const counts = new Map<string, number>();
  for (const term of docTerms) counts.set(term, (counts.get(term) ?? 0) + 1);
  let total = 0;
  for (const term of queryTerms) {
    const n = counts.get(term) ?? 0;
    if (n > 0) total += 1 + Math.log(n);
  }
  return total;
}
