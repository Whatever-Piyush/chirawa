import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Language } from './translations';

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
}

const STORAGE_KEY = 'bringly_language';

const LanguageContext = createContext<LanguageContextValue>({
  language: 'hi',
  setLanguage: () => undefined,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('hi');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'en' || stored === 'hi') setLanguageState(stored);
      })
      .catch(() => undefined);
  }, []);

  function setLanguage(lang: Language) {
    setLanguageState(lang);
    AsyncStorage.setItem(STORAGE_KEY, lang).catch(() => undefined);
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
