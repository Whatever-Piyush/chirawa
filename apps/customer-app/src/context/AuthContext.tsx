import React, {
  createContext, useContext, useEffect,
  useReducer, type ReactNode,
} from 'react';
import { StorageService } from '../services/storage.service';
import { api } from '../services/api.service';

interface AuthState {
  isLoading:       boolean;
  isAuthenticated: boolean;
  userId:          string | null;
  role:            string | null;
  phone:           string | null;
}

type AuthAction =
  | { type: 'RESTORE_TOKEN';  userId: string; role: string }
  | { type: 'SIGN_IN';        userId: string; role: string; phone: string }
  | { type: 'SIGN_OUT' }
  | { type: 'SET_LOADING';    isLoading: boolean };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'RESTORE_TOKEN':
      return { ...state, isLoading: false, isAuthenticated: true, userId: action.userId, role: action.role };
    case 'SIGN_IN':
      return { ...state, isLoading: false, isAuthenticated: true, userId: action.userId, role: action.role, phone: action.phone };
    case 'SIGN_OUT':
      return { ...state, isAuthenticated: false, userId: null, role: null, phone: null };
    case 'SET_LOADING':
      return { ...state, isLoading: action.isLoading };
    default:
      return state;
  }
}

interface AuthContextType {
  state:    AuthState;
  signIn:   (userId: string, role: string, phone: string) => void;
  signOut:  () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, {
    isLoading:       true,
    isAuthenticated: false,
    userId:          null,
    role:            null,
    phone:           null,
  });

  // When the api-client gives up on a session (refresh failed / still 401 after
  // retry) it calls onAuthFailure. Clear state so the navigator falls back to
  // the auth stack — tokens have already been cleared inside the client.
  useEffect(() => {
    api.onAuthFailure = () => {
      dispatch({ type: 'SIGN_OUT' });
    };
    return () => { api.onAuthFailure = null; };
  }, []);

  // Restore session on app launch
  useEffect(() => {
    async function restoreSession() {
      try {
        const token = await StorageService.getAccessToken();
        if (token) {
          // Token exists — verify it's still valid by fetching profile
          const profile = await api.getShops(); // lightweight call
          void profile;
          // If we get here, token is valid
          // Decode userId from token (it's a JWT, we can decode without verify)
          const payload = JSON.parse(atob(token.split('.')[1] ?? '')) as {
            sub: string; role: string;
          };
          dispatch({ type: 'RESTORE_TOKEN', userId: payload.sub, role: payload.role });
        } else {
          dispatch({ type: 'SET_LOADING', isLoading: false });
        }
      } catch {
        // Token invalid or expired
        await StorageService.clearTokens();
        dispatch({ type: 'SET_LOADING', isLoading: false });
      }
    }
    void restoreSession();
  }, []);

  const signIn = (userId: string, role: string, phone: string) => {
    dispatch({ type: 'SIGN_IN', userId, role, phone });
  };

  const signOut = async () => {
    await StorageService.clearTokens();
    dispatch({ type: 'SIGN_OUT' });
  };

  return (
    <AuthContext.Provider value={{ state, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
