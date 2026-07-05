import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { translations, type Language } from './translations';

// Re-export the pure translation data + Language type so any host (web,
// server, tests) can pull everything it needs from this headless entry
// WITHOUT dragging in the React Native provider (and its AsyncStorage import).
export { translations };
export type { Language };

// ─── Storage seam ───────────────────────────────────────────────────────────
// Each platform injects its own persistence: AsyncStorage on React Native,
// localStorage + cookie on web. Reads/writes may be sync or async.
export type LanguageStorage = {
  get: () => Promise<Language | null> | Language | null;
  set: (language: Language) => Promise<void> | void;
};

export interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  /** null until persistence has been read; then true iff a saved choice existed. */
  hasChosen: boolean | null;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'hi',
  setLanguage: () => undefined,
  hasChosen: null,
});

export interface LanguageCoreProviderProps {
  children: ReactNode;
  /** Persistence seam. Omit for an ephemeral (non-persisted) provider. */
  storage?: LanguageStorage;
  /** Language shown before persistence is read. Defaults to Hindi. */
  defaultLanguage?: Language;
  /** Seed the language synchronously (e.g. from an SSR cookie read). */
  initialLanguage?: Language;
}

// Headless provider — no platform imports. It is the single source of the
// language context that useT / useLanguage read, under BOTH the RN provider
// (AsyncStorage) and the web provider (localStorage + cookie).
export function LanguageCoreProvider({
  children,
  storage,
  defaultLanguage = 'hi',
  initialLanguage,
}: LanguageCoreProviderProps) {
  const [language, setLanguageState] = useState<Language>(initialLanguage ?? defaultLanguage);
  const [hasChosen, setHasChosen] = useState<boolean | null>(null);

  // Hydrate the persisted choice once, after mount. Rendering always starts at
  // the default so SSR and first client render agree (no hydration mismatch).
  useEffect(() => {
    if (!storage) return;
    let cancelled = false;
    Promise.resolve(storage.get())
      .then((stored) => {
        if (cancelled) return;
        if (stored === 'en' || stored === 'hi') {
          setLanguageState(stored);
          setHasChosen(true);
        } else {
          setHasChosen(false);
        }
      })
      .catch(() => {
        if (!cancelled) setHasChosen(false);
      });
    return () => {
      cancelled = true;
    };
  }, [storage]);

  const setLanguage = useCallback(
    (next: Language) => {
      setLanguageState(next);
      setHasChosen(true);
      if (storage) Promise.resolve(storage.set(next)).catch(() => undefined);
    },
    [storage],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage, hasChosen }),
    [language, setLanguage, hasChosen],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

// Nested-key translation getter: 'home.searchPlaceholder' → the leaf string for
// the active language, falling back to English, then to the key itself.
export function useT(): (key: string) => string {
  const { language } = useLanguage();

  return useCallback(
    (key: string): string => {
      const parts = key.split('.');
      let node: Record<string, unknown> = translations as unknown as Record<string, unknown>;

      for (const part of parts) {
        const child: unknown = node[part];
        if (child == null || typeof child !== 'object') return key;
        node = child as Record<string, unknown>;
      }

      const val: unknown = node[language];
      if (typeof val === 'string') return val;

      const fallback: unknown = node['en'];
      return typeof fallback === 'string' ? fallback : key;
    },
    [language],
  );
}
