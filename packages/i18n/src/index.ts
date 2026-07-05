export { translations } from './translations';
export type { Language } from './translations';

// Headless core — safe for web / any non-RN host (no AsyncStorage).
export {
  LanguageCoreProvider,
  useLanguage,
  useT,
} from './core';
export type {
  LanguageStorage,
  LanguageContextValue,
  LanguageCoreProviderProps,
} from './core';

// React Native provider (pulls @react-native-async-storage/async-storage).
// Import this ONLY from RN apps — never from the web build graph.
export { LanguageProvider } from './LanguageContext';
