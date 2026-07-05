'use client';

import type { ReactNode } from 'react';
import {
  LanguageCoreProvider,
  useLanguage,
  useT,
  type Language,
  type LanguageStorage,
} from '@chirawa/i18n/core';

// Web persistence for the language choice. localStorage is the fast per-device
// store; the `lang` cookie mirrors it so a future Server Component can read the
// choice (via next/headers) and seed `initialLanguage` for SSR. Importing from
// '@chirawa/i18n/core' keeps AsyncStorage out of the web bundle entirely.

const STORAGE_KEY = 'bringly_language';
const COOKIE_KEY = 'lang';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function readCookieLanguage(): Language | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)lang=(en|hi)(?:;|$)/);
  const value = match?.[1];
  return value === 'en' || value === 'hi' ? value : null;
}

const webLanguageStorage: LanguageStorage = {
  get: (): Language | null => {
    if (typeof window !== 'undefined') {
      try {
        const v = window.localStorage.getItem(STORAGE_KEY);
        if (v === 'en' || v === 'hi') return v;
      } catch {
        /* localStorage blocked (private mode) — fall through to the cookie */
      }
    }
    return readCookieLanguage();
  },
  set: (language: Language): void => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEY, language);
      } catch {
        /* ignore write failures (private mode / quota) */
      }
    }
    if (typeof document !== 'undefined') {
      document.cookie = `${COOKIE_KEY}=${language};path=/;max-age=${COOKIE_MAX_AGE};samesite=lax`;
    }
  },
};

// Hindi-default web provider (matches the app's `language: 'hi'`).
export function LanguageProvider({ children }: { children: ReactNode }) {
  return (
    <LanguageCoreProvider storage={webLanguageStorage} defaultLanguage="hi">
      {children}
    </LanguageCoreProvider>
  );
}

// Re-export the hooks so web modules import all i18n from one place.
export { useLanguage, useT };
export type { Language };
