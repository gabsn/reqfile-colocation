/** Splits on whitespace and cuts words longer than `width`. */
export function breakWords(text: string, width: number): string[] {
  const out: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
  }
  return out;
}
