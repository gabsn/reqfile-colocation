import { renderDigest } from "@acme/emails";

export function sendDigest(items: string[], send: (subject: string, html: string) => void): void {
  if (items.length === 0) return;
  const email = renderDigest(items);
  send(email.subject, email.html);
}
