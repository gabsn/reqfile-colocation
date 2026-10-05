import { formatDigest } from "../notifications";

export function weeklyReport(week: number, closed: string[]): string {
  return `Week ${week}\n${formatDigest(closed)}`;
}
