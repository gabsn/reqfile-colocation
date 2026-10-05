export function renderChangelog(template: string, version: string, entries: string[]): string {
  const list = entries.map((e) => `- ${e}`).join("\n");
  return template.replaceAll("{{version}}", version).replaceAll("{{entries}}", list);
}
