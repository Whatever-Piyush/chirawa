import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Language } from './translations';

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  hasChosen: boolean | null;
}

const STORAGE_KEY = 'bringly_language';

const LanguageContext = createContext<LanguageContextValue>({
  language: 'hi',
  setLanguage: () => undefined,
  hasChosen: null,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('hi');
  const [hasChosen, setHasChosen] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'en' || stored === 'hi') {
          setLanguageState(stored);
          setHasChosen(true);
        } else {
          setHasChosen(false);
        }
      })
      .catch(() => {
        setHasChosen(false);
      });
  }, []);

  function setLanguage(lang: Language) {
    setLanguageState(lang);
    setHasChosen(true);
    AsyncStorage.setItem(STORAGE_KEY, lang).catch(() => undefined);
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, hasChosen }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
