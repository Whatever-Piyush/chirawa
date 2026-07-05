import type { Config } from 'tailwindcss';

// ─── Bringly design tokens ────────────────────────────────────────────────
// Ported verbatim from apps/customer-app/src/theme/index.ts so the web
// storefront matches the app. Keep hex/sizes in sync with that file.
const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#FF6B35', // brand orange
          dark: '#E85520', // pressed
          light: '#FFF0E9', // tinted chip / soft hero wash
          mid: '#FFD0B8',
        },
        cream: '#FFF5EE', // page background (warm cream)
        surface: {
          DEFAULT: '#FFFFFF',
          alt: '#F2F3F5',
        },
        ink: {
          DEFAULT: '#1A1A2E', // primary text
          muted: '#6B7280', // secondary text
          faint: '#9AA5B4', // tertiary text
          inverse: '#FFFFFF',
        },
        success: { DEFAULT: '#00C48C', light: '#E6FAF4' },
        warning: { DEFAULT: '#FFB020', light: '#FFF5E0' },
        danger: { DEFAULT: '#FF4D4F', light: '#FFF1F0' },
        info: { DEFAULT: '#4096FF', light: '#E6F0FF' },
        hairline: '#F0E0D6', // warm-toned border
        divider: '#F2F3F5',
        special: {
          DEFAULT: '#FFF3E0', // section bg tint
          border: '#FFCC80', // card border
          accent: '#C4383A', // deep red — Special header/button
        },
      },
      fontSize: {
        xxs: '10px',
        xs: '12px',
        sm: '13px',
        md: '15px',
        lg: '17px',
        xl: '20px',
        xxl: '24px',
        xxxl: '30px',
        hero: '38px',
      },
      fontWeight: {
        regular: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
        black: '800',
        heavy: '900',
      },
      borderRadius: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
        '2xl': '32px',
        full: '999px',
      },
      spacing: {
        xxs: '2px',
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        xxl: '24px',
        xxxl: '32px',
        huge: '48px',
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
          'Apple Color Emoji',
          'Segoe UI Emoji',
        ],
      },
      backgroundImage: {
        // Gradients.primary / Gradients.warm from the theme.
        'brand-gradient': 'linear-gradient(135deg, #FF6B35 0%, #FF9A5C 100%)',
        'brand-warm': 'linear-gradient(135deg, #FF6B35 0%, #FFB07A 100%)',
      },
      boxShadow: {
        card: '0 2px 6px rgba(0,0,0,0.06)',
        soft: '0 4px 12px rgba(0,0,0,0.08)',
        primary: '0 4px 12px rgba(255,107,53,0.30)',
      },
      maxWidth: {
        content: '72rem',
      },
    },
  },
  plugins: [],
};

export default config;
