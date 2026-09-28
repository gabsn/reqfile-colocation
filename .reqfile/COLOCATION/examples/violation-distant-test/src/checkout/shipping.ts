export function shippingCents(weightGrams: number): number {
  return weightGrams > 2000 ? 900 : 490;
}
