import type { Parcel } from "../models/parcel";

export function ship(grams: number): Parcel {
  return { grams, cost: grams > 2000 ? 900 : 490 };
}
