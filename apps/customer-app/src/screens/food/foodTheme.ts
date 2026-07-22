// ─── Food module palette (Food.md §8) ─────────────────────────────────────────
// Warm, appetite-friendly accents for the Food surfaces — local to the food
// screens (same precedent as screens/home/nightTheme.ts) so the shared theme
// files stay untouched. Distinct from the Special/maroon world, consistent
// with Bringly's design language.

export const FOOD_ACCENT       = '#E8590C'; // warm tandoor orange — buttons, active states
export const FOOD_ACCENT_DEEP  = '#C2410C'; // pressed / gradients
export const FOOD_ACCENT_SOFT  = '#FFF1E6'; // soft chips / pills on light surfaces
export const FOOD_HEADER_FROM  = '#7C2D12'; // header gradient — deep roasted brown
export const FOOD_HEADER_TO    = '#E8590C';
export const FOOD_VEG          = '#2E7D32'; // veg marker
export const FOOD_NONVEG       = '#C62828'; // non-veg marker

// Per-restaurant card gradients (letter-avatar / hero fallbacks when no image).
export const FOOD_CARD_GRADIENTS = [
  ['#7C2D12', '#F97316'],
  ['#9F1239', '#FB7185'],
  ['#78350F', '#F59E0B'],
  ['#14532D', '#4ADE80'],
  ['#581C87', '#C084FC'],
  ['#164E63', '#2DD4BF'],
] as const;

export function foodGradient(index: number): readonly [string, string] {
  const g = FOOD_CARD_GRADIENTS[index % FOOD_CARD_GRADIENTS.length]!;
  return [g[0], g[1]];
}
