import { layout } from "./layout";

export interface Email {
  subject: string;
  html: string;
}

export function renderWelcome(name: string): Email {
  return { subject: `Welcome, ${name}`, html: layout(`<p>Hi ${name}, glad you are here.</p>`) };
}

export function renderDigest(items: string[]): Email {
  const list = items.map((i) => `<li>${i}</li>`).join("");
  return { subject: `${items.length} updates`, html: layout(`<ul>${list}</ul>`) };
}
