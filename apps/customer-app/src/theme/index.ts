// ─── Design tokens — Bringly customer app ─────────────────────────────────
// Single source of truth. No hardcoded hex/sizes anywhere in screens.

export const Colors = {
  // Brand — Chirawa Orange (rebrand from pink Phase 6)
  primary:       '#FF6B35',   // brand orange
  primaryDark:   '#E85520',   // pressed
  primaryLight:  '#FFF0E9',   // tinted chip bg / soft hero washes
  primaryMid:    '#FFD0B8',

  // Neutrals — warm cream surfaces (food/grocery feel, not clinical white)
  black:         '#0D0D0D',
  white:         '#FFFFFF',
  background:    '#FFF5EE',   // page bg (warm cream)
  surface:       '#FFFFFF',
  surfaceAlt:    '#F2F3F5',

  // Text
  textPrimary:   '#1A1A2E',
  textSecondary: '#6B7280',   // slightly cooler grey reads premium on cream
  textTertiary:  '#9AA5B4',
  textInverse:   '#FFFFFF',

  // Semantic
  success:       '#00C48C',
  successLight:  '#E6FAF4',
  warning:       '#FFB020',
  warningLight:  '#FFF5E0',
  error:         '#FF4D4F',
  errorLight:    '#FFF1F0',
  info:          '#4096FF',
  infoLight:     '#E6F0FF',

  // UI
  border:        '#F0E0D6',   // warm-toned border to harmonise with cream bg
  borderFocus:   '#FF6B35',
  divider:       '#F2F3F5',
  overlay:       'rgba(0,0,0,0.45)',
  overlayLight:  'rgba(0,0,0,0.06)',
  shimmer:       '#EBEBEB',
  shimmerHigh:   '#F5F5F5',

  // Category-chip tints (used by CategoryTabs + Bestsellers)
  chipGrocery:   '#FFF0E9',
  chipSnacks:    '#FFF8E1',
  chipDairy:     '#E8F5E9',
  chipBeauty:    '#FDF2F8',
  chipActive:    '#FF6B35',

  // Chirawa's Special — signature local-shops treatment
  special:        '#FFF3E0',   // section bg tint
  specialBorder:  '#FFCC80',   // card border
  specialAccent:  '#C4383A',   // deep red — Special button + section header

  // Bottom nav
  footerBg:      '#FFFFFF',
  footerBorder:  '#F0E0D6',

  // Legacy aliases — kept so existing screens compile while we migrate
  text:          '#1A1A2E',
  textLight:     '#6B7280',
  textMuted:     '#9AA5B4',
  card:          '#FFFFFF',
  accent:        '#00C48C',   // NOTE: legacy green alias for `success` (riders/badges). The
                              // spec's "accent" red lives at `specialAccent` so this stays.
  secondary:     '#2D3436',
  disabled:      '#C8B8A8',
  shimmer1:      '#EBEBEB',
  shimmer2:      '#F5F5F5',
};

export const FontSize = {
  xxs:  10,
  xs:   12,
  sm:   13,
  md:   15,
  lg:   17,
  xl:   20,
  xxl:  24,
  xxxl: 30,
  hero: 38,
};

export const FontWeight = {
  regular:  '400' as const,
  medium:   '500' as const,
  semibold: '600' as const,
  bold:     '700' as const,
  black:    '800' as const,
  heavy:    '900' as const,
};

export const Spacing = {
  xxs:  2,
  xs:   4,
  sm:   8,
  md:  12,
  lg:  16,
  xl:  20,
  xxl: 24,
  xxxl:32,
  huge: 48,
};

export const Radius = {
  xs:   4,
  sm:   8,
  md:  12,
  lg:  16,
  xl:  24,
  xxl: 32,
  full:999,
};

export const Shadow = {
  none: {},
  xs: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
  primary: {
    shadowColor: '#FF6B35',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.30,
    shadowRadius: 12,
    elevation: 8,
  },
  special: {
    shadowColor: '#C4383A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
  },

  // Legacy aliases — kept so existing screens compile while we migrate
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  strong: {
    shadowColor: '#FF6B35',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.30,
    shadowRadius: 12,
    elevation: 8,
  },
};

export const MIN_TAP = 48;
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

// Gradient pairs — used by FauxGradient overlapping View pattern
export const Gradients = {
  primary: ['#FF6B35', '#FF9A5C'] as const,
  warm:    ['#FF6B35', '#FFB07A'] as const,
  success: ['#00C48C', '#00E0A4'] as const,
};

// Poppins font-family mapping — kept beside FontWeight so theme + typography
// stay in sync. Falls back to System if Poppins isn't loaded yet.
// 800/900 don't have dedicated Poppins weights here so they share Bold.
export function poppinsFamily(weight: keyof typeof FontWeight | string | undefined): string {
  switch (weight) {
    case 'regular':
    case '400': return 'Poppins_400Regular';
    case 'medium':
    case '500': return 'Poppins_500Medium';
    case 'semibold':
    case '600': return 'Poppins_600SemiBold';
    case 'bold':
    case '700':
    case 'black':
    case '800':
    case 'heavy':
    case '900': return 'Poppins_700Bold';
    default:    return 'Poppins_400Regular';
  }
}
