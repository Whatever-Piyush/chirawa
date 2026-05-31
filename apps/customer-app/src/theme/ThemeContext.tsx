import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors as LightColors } from './index';

// ─── Dark palette ───────────────────────────────────────────────────────────
// Mirrors every key in the light `Colors` so any screen reading from the theme
// gets a valid value in both modes. Brand orange is preserved; surfaces/text
// are inverted to a warm-neutral dark scheme.
const DarkColors: typeof LightColors = {
  primary: '#FF6B35',
  primaryDark: '#E85520',
  primaryLight: '#3A2418',
  primaryMid: '#5A3420',

  black: '#0D0D0D',
  white: '#FFFFFF',
  background: '#121212',
  surface: '#1E1E1E',
  surfaceAlt: '#2A2A2A',

  textPrimary: '#F5F5F5',
  textSecondary: '#A0A0A0',
  textTertiary: '#6B7280',
  textInverse: '#FFFFFF',

  success: '#00C48C',
  successLight: '#10302A',
  warning: '#FFB020',
  warningLight: '#332B14',
  error: '#FF6B6B',
  errorLight: '#3A1A1A',
  info: '#4096FF',
  infoLight: '#16243A',

  border: '#2E2E2E',
  borderFocus: '#FF6B35',
  divider: '#2A2A2A',
  overlay: 'rgba(0,0,0,0.6)',
  overlayLight: 'rgba(255,255,255,0.06)',
  shimmer: '#2A2A2A',
  shimmerHigh: '#333333',

  chipGrocery: '#3A2418',
  chipSnacks: '#332B14',
  chipDairy: '#10302A',
  chipBeauty: '#33222B',
  chipActive: '#FF6B35',

  special: '#3A2A18',
  specialBorder: '#5A4424',
  specialAccent: '#FF7A6B',

  footerBg: '#1E1E1E',
  footerBorder: '#2E2E2E',

  text: '#F5F5F5',
  textLight: '#A0A0A0',
  textMuted: '#6B7280',
  card: '#1E1E1E',
  accent: '#00C48C',
  secondary: '#E0E0E0',
  disabled: '#555555',
  shimmer1: '#2A2A2A',
  shimmer2: '#333333',
};

export type ColorPalette = typeof LightColors;
export type ThemeMode = 'light' | 'dark' | 'system';
export type ColorScheme = 'light' | 'dark';

const STORAGE_KEY = '@theme_mode';

interface ThemeContextType {
  /** User's stored preference. */
  mode: ThemeMode;
  /** Resolved scheme actually in effect (system → device value). */
  scheme: ColorScheme;
  /** Active palette for the resolved scheme. */
  colors: ColorPalette;
  setMode: (mode: ThemeMode) => void;
}

// Default to light so any consumer rendered outside the provider (e.g. the
// ErrorBoundary fallback) still gets a valid palette instead of crashing.
const ThemeContext = createContext<ThemeContextType>({
  mode: 'system',
  scheme: 'light',
  colors: LightColors,
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Restore the saved preference on mount.
  useEffect(() => {
    void (async () => {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        setModeState(saved);
      }
    })();
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  };

  const scheme: ColorScheme =
    mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;

  const value = useMemo<ThemeContextType>(
    () => ({
      mode,
      scheme,
      colors: scheme === 'dark' ? DarkColors : LightColors,
      setMode,
    }),
    [mode, scheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextType {
  return useContext(ThemeContext);
}
