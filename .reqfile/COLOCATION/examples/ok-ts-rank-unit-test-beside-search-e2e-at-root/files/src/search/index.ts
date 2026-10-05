import { score } from "./rank";
import { tokenize } from "./tokenize";

export function search(query: string, docs: { id: string; text: string }[]): string[] {
  const terms = tokenize(query);
  return docs
    .map((doc) => ({ id: doc.id, score: score(terms, tokenize(doc.text)) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map((hit) => hit.id);
}
