import { renderWelcome } from "@acme/emails";

export function onSignup(name: string, send: (subject: string, html: string) => void): void {
  const email = renderWelcome(name);
  send(email.subject, email.html);
}
