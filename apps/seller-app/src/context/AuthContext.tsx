import React, { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react';
import { StorageService } from '../services/storage.service';
import { setAuthFailureHandler, setTokenRefreshedHandler } from '../services/api.service';

interface AuthState {
  isLoading: boolean; isAuthenticated: boolean;
  token: string | null; userId: string | null;
  requiresPin: boolean;
}
type AuthAction =
  | { type: 'RESTORE'; token: string; userId: string }
  | { type: 'SIGN_IN'; token: string; userId: string; requiresPin: boolean }
  | { type: 'TOKEN_REFRESHED'; token: string }
  | { type: 'PIN_SET' }
  | { type: 'SIGN_OUT' }
  | { type: 'LOADED' };

function reducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'RESTORE':         return { ...state, isLoading: false, isAuthenticated: true, token: action.token, userId: action.userId };
    case 'SIGN_IN':         return { ...state, isLoading: false, isAuthenticated: true, token: action.token, userId: action.userId, requiresPin: action.requiresPin };
    case 'TOKEN_REFRESHED': return { ...state, token: action.token };
    case 'PIN_SET':         return { ...state, requiresPin: false };
    case 'SIGN_OUT':        return { ...state, isAuthenticated: false, token: null, userId: null, requiresPin: false };
    case 'LOADED':          return { ...state, isLoading: false };
    default:                return state;
  }
}

interface AuthContextType {
  state:   AuthState;
  signIn:  (token: string, userId: string, requiresPin: boolean) => void;
  pinSet:  () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    isLoading: true, isAuthenticated: false,
    token: null, userId: null, requiresPin: false,
  });

  useEffect(() => {
    void (async () => {
      try {
        const token = await StorageService.getAccessToken();
        if (token) {
          const payload = JSON.parse(atob(token.split('.')[1] ?? '')) as { sub: string };
          dispatch({ type: 'RESTORE', token, userId: payload.sub });
        } else {
          dispatch({ type: 'LOADED' });
        }
      } catch {
        dispatch({ type: 'LOADED' });
      }
    })();
  }, []);

  // Wire api.service refresh callbacks → React state.
  // - onTokenRefreshed: keep in-memory token in sync with SecureStore after a silent refresh
  // - onAuthFailure:    refresh ultimately failed, drop the session so the navigator returns to login
  useEffect(() => {
    setTokenRefreshedHandler((accessToken) => {
      dispatch({ type: 'TOKEN_REFRESHED', token: accessToken });
    });
    setAuthFailureHandler(() => {
      dispatch({ type: 'SIGN_OUT' });
    });
    return () => {
      setTokenRefreshedHandler(null);
      setAuthFailureHandler(null);
    };
  }, []);

  return (
    <AuthContext.Provider value={{
      state,
      signIn:  (token, userId, requiresPin) => dispatch({ type: 'SIGN_IN', token, userId, requiresPin }),
      pinSet:  () => dispatch({ type: 'PIN_SET' }),
      signOut: async () => { await StorageService.clearTokens(); dispatch({ type: 'SIGN_OUT' }); },
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
