// GS1 modulo-10 check-digit validation for GTIN barcodes — the join key for the
// catalog engine (Phase 0). A distributor's "barcode" column is frequently an
// internal SKU, not a real GTIN, so every barcode is gated through this before
// it's trusted for OFF image matching or cross-shop aggregation.
//
// Supported lengths: GTIN-8 (EAN-8), GTIN-12 (UPC-A), GTIN-13 (EAN-13),
// GTIN-14 (shipping/case codes). The same algorithm validates all four because
// the weights are aligned from the right.
//
// Algorithm (GS1 standard): starting from the rightmost *data* digit (excluding
// the trailing check digit), weight digits alternately ×3, ×1, ×3, …; sum them;
// the check digit is whatever makes that sum a multiple of 10.
// Ref: https://www.gs1.org/services/how-calculate-check-digit-manually

const VALID_GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * True iff `code` is a syntactically valid GTIN/EAN: digits only, a supported
 * length, and a correct GS1 check digit. Leading/trailing whitespace is trimmed;
 * null/undefined/empty/non-numeric all return false (never throws).
 */
export function isValidEan(code: string | null | undefined): boolean {
  if (code == null) return false;
  const digits = code.trim();
  if (!/^\d+$/.test(digits)) return false;            // digits only — no spaces/letters/signs
  if (!VALID_GTIN_LENGTHS.has(digits.length)) return false;

  let sum = 0;
  // Walk the data digits right→left; the rightmost data digit is weighted ×3.
  for (let i = digits.length - 2, weightIsThree = true; i >= 0; i--, weightIsThree = !weightIsThree) {
    sum += Number(digits[i]) * (weightIsThree ? 3 : 1);
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === Number(digits[digits.length - 1]);
}
