import { formatDigest } from "./format";

export function sendDigest(to: string, items: string[]): string {
  const message = `To: ${to}\nSubject: Your digest\n\n${formatDigest(items)}`;
  console.log(message);
  return message;
}
