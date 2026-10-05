import { ellipsis } from "../internal/ellipsis";

/** Shortens text to at most `max` characters, ending with an ellipsis when cut. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - ellipsis.length)) + ellipsis;
}
