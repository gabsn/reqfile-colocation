import type { Query } from "../api/__generated__/graphql";

export function balance(query: Query): string {
  return `${query.coins} coins`;
}
