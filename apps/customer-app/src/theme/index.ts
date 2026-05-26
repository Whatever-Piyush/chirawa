export const Colors = {
  primary:      '#FF3E6C',          // Bringly pink
  primaryDark:  '#E0325A',          // pressed state
  primaryLight: '#FFF0F3',          // tinted backgrounds
  secondary:    '#2D3436',          // rich black for headings
  accent:       '#00B894',          // success green
  warning:      '#FDCB6E',          // warning amber
  error:        '#D63031',          // error red
  background:   '#F8F9FA',          // off-white page bg
  card:         '#FFFFFF',          // card white
  border:       '#EEEEEE',          // subtle borders
  text:         '#1A1A2E',          // primary text
  textLight:    '#636E72',          // secondary text
  textMuted:    '#B2BEC3',          // placeholder text
  white:        '#FFFFFF',
  black:        '#000000',
  success:      '#00B894',
  overlay:      'rgba(0,0,0,0.5)',
  shimmer1:     '#F0F0F0',          // skeleton base
  shimmer2:     '#E0E0E0',          // skeleton highlight
  disabled:     '#C8B8A8',          // legacy — kept for back-compat
};

export const Spacing = {
  xs:   4,
  sm:   8,
  md:  12,
  lg:  16,
  xl:  20,
  xxl: 24,
  xxxl:32,
};

export const FontSize = {
  xs:    11,
  sm:    13,
  md:    15,
  lg:    17,
  xl:    20,
  xxl:   24,
  xxxl:  32,
  hero:  40,
};

export const FontWeight = {
  regular:  '400' as const,
  medium:   '500' as const,
  semibold: '600' as const,
  bold:     '700' as const,
  black:    '800' as const,
};

export const Radius = {
  sm:   6,
  md:  10,
  lg:  16,
  xl:  20,
  full:999,
};

export const Shadow = {
  card: {
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius:  8,
    elevation:     3,
  },
  strong: {
    shadowColor:   '#FF3E6C',
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius:  12,
    elevation:     8,
  },
};

export const MIN_TAP = 48;

// Gradient pairs — to be used by faux-gradient overlapping View pattern
export const Gradients = {
  primary:  ['#FF3E6C', '#FF6B9D'] as const,
  warm:     ['#FF3E6C', '#FF8C42'] as const,
};
