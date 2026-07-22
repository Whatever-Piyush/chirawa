import type { ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Language } from './translations';
import { LanguageCoreProvider, useLanguage, type LanguageStorage } from './core';

// This file is the ONLY place the RN-only AsyncStorage import lives. Web hosts
// import from '@chirawa/i18n/core' and never pull this module (or AsyncStorage).

const STORAGE_KEY = 'bringly_language';

// AsyncStorage-backed persistence seam for the React Native apps.
const asyncStorage: LanguageStorage = {
  get: async (): Promise<Language | null> => {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return stored === 'en' || stored === 'hi' ? stored : null;
  },
  set: async (language: Language): Promise<void> => {
    await AsyncStorage.setItem(STORAGE_KEY, language);
  },
};

// Drop-in RN provider — unchanged public API (default Hindi, AsyncStorage
// persistence, hasChosen semantics), now built on the headless core.
export function LanguageProvider({ children }: { children: ReactNode }) {
  return (
    <LanguageCoreProvider storage={asyncStorage} defaultLanguage="hi">
      {children}
    </LanguageCoreProvider>
  );
}

// Preserve the original export surface of this module.
export { useLanguage };
