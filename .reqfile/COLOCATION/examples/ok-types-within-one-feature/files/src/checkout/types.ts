export type Address = { street: string; city: string; postcode: string };

export type PaymentMethod = { kind: "card" | "transfer"; last4?: string };
