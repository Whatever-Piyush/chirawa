// ─── Design tokens — Bringly customer app ─────────────────────────────────
// Single source of truth. No hardcoded hex/sizes anywhere in screens.

export const Colors = {
  // Brand
  primary:       '#FF3E6C',
  primaryDark:   '#E0325A',
  primaryLight:  '#FFF0F3',
  primaryMid:    '#FFD6DF',

  // Neutrals
  black:         '#0D0D0D',
  white:         '#FFFFFF',
  background:    '#F7F8FA',
  surface:       '#FFFFFF',
  surfaceAlt:    '#F2F3F5',

  // Text
  textPrimary:   '#1A1A2E',
  textSecondary: '#4A5568',
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
  border:        '#EAECF0',
  borderFocus:   '#FF3E6C',
  divider:       '#F2F3F5',
  overlay:       'rgba(0,0,0,0.45)',
  overlayLight:  'rgba(0,0,0,0.06)',
  shimmer:       '#EBEBEB',
  shimmerHigh:   '#F5F5F5',

  // Legacy aliases — kept so existing screens compile while we migrate
  text:          '#1A1A2E',
  textLight:     '#4A5568',
  textMuted:     '#9AA5B4',
  card:          '#FFFFFF',
  accent:        '#00C48C',
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
    shadowColor: '#FF3E6C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.30,
    shadowRadius: 12,
    elevation: 8,
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
    shadowColor: '#FF3E6C',
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
  primary: ['#FF3E6C', '#FF6B9D'] as const,
  warm:    ['#FF3E6C', '#FF8C42'] as const,
  success: ['#00C48C', '#00E0A4'] as const,
};
