/**
 * Monetary values are ALWAYS stored and computed as integer paise (×100).
 * ₹150.00 = 15000 Paise
 *
 * NEVER use floating-point arithmetic for money.
 * 0.1 + 0.2 = 0.30000000000000004 in IEEE 754.
 *
 * This branded type makes the intent explicit and prevents accidental
 * mixing of rupee and paise values.
 */
export type Paise = number & { readonly __brand: 'Paise' };

export function toPaise(rupees: number): Paise {
  // Round to avoid any floating point from the input
  return Math.round(rupees * 100) as Paise;
}

export function toRupees(paise: Paise): number {
  return paise / 100;
}

export function formatRupees(paise: Paise): string {
  return `₹${(paise / 100).toFixed(0)}`;
}

// Type guard
export function isPaise(value: unknown): value is Paise {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}