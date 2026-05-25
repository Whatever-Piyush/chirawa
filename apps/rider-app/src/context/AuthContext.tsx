import React, { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react';
import { StorageService } from '../services/storage.service';

interface AuthState {
  isLoading: boolean; isAuthenticated: boolean;
  token: string | null; userId: string | null; requiresPin: boolean;
}
type Action =
  | { type: 'RESTORE'; token: string; userId: string }
  | { type: 'SIGN_IN'; token: string; userId: string; requiresPin: boolean }
  | { type: 'PIN_SET' } | { type: 'SIGN_OUT' } | { type: 'LOADED' };

function reducer(s: AuthState, a: Action): AuthState {
  switch (a.type) {
    case 'RESTORE':  return { ...s, isLoading: false, isAuthenticated: true, token: a.token, userId: a.userId };
    case 'SIGN_IN':  return { ...s, isLoading: false, isAuthenticated: true, token: a.token, userId: a.userId, requiresPin: a.requiresPin };
    case 'PIN_SET':  return { ...s, requiresPin: false };
    case 'SIGN_OUT': return { ...s, isAuthenticated: false, token: null, userId: null };
    case 'LOADED':   return { ...s, isLoading: false };
    default:         return s;
  }
}

const Ctx = createContext<{
  state: AuthState;
  signIn: (token: string, userId: string, requiresPin: boolean) => void;
  pinSet: () => void;
  signOut: () => Promise<void>;
} | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    isLoading: true, isAuthenticated: false, token: null, userId: null, requiresPin: false,
  });

  useEffect(() => {
    void (async () => {
      try {
        const token = await StorageService.getAccessToken();
        if (token) {
          const p = JSON.parse(atob(token.split('.')[1] ?? '')) as { sub: string };
          dispatch({ type: 'RESTORE', token, userId: p.sub });
        } else dispatch({ type: 'LOADED' });
      } catch { dispatch({ type: 'LOADED' }); }
    })();
  }, []);

  return (
    <Ctx.Provider value={{
      state,
      signIn: (token, userId, requiresPin) => dispatch({ type: 'SIGN_IN', token, userId, requiresPin }),
      pinSet: () => dispatch({ type: 'PIN_SET' }),
      signOut: async () => { await StorageService.clearTokens(); dispatch({ type: 'SIGN_OUT' }); },
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
