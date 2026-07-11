import React, { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react';
import { ApiError } from '@chirawa/api-client';
import { StorageService } from '../services/storage.service';
import { api } from '../services/api.service';
import AsyncStorage from '@react-native-async-storage/async-storage'; // Ensure this is imported

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  userId: string | null;
  role: string | null;
  phone: string | null;
  name: string | null; // 🔴 NEW
  dob: string | null; // 🔴 NEW
}

type AuthAction =
  | { type: 'RESTORE_TOKEN'; userId: string; role: string; phone: string | null; name: string | null; dob: string | null }
  | { type: 'SIGN_IN'; userId: string; role: string; phone: string; name: string | null }
  | { type: 'SIGN_OUT' }
  | { type: 'SET_LOADING'; isLoading: boolean }
  | { type: 'UPDATE_PROFILE'; name: string; dob: string };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'RESTORE_TOKEN':
      return {
        ...state,
        isLoading: false,
        isAuthenticated: true,
        userId: action.userId,
        role: action.role,
        phone: action.phone,
        name: action.name,
        dob: action.dob,
      };
    case 'SIGN_IN':
      return {
        ...state,
        isLoading: false,
        isAuthenticated: true,
        userId: action.userId,
        role: action.role,
        phone: action.phone,
        name: action.name,
      };
    case 'UPDATE_PROFILE':
      return { ...state, name: action.name, dob: action.dob };
    case 'SIGN_OUT':
      return {
        ...state,
        isAuthenticated: false,
        userId: null,
        role: null,
        phone: null,
        name: null,
        dob: null,
      };
    case 'SET_LOADING':
      return { ...state, isLoading: action.isLoading };
    default:
      return state;
  }
}

interface AuthContextType {
  state: AuthState;
  signIn: (userId: string, role: string, phone: string, name?: string | null) => void;
  signOut: () => Promise<void>;
  updateProfile: (name: string, dob: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, {
    isLoading: true,
    isAuthenticated: false,
    userId: null,
    role: null,
    phone: null,
    name: null,
    dob: null,
  });

  useEffect(() => {
    api.onAuthFailure = () => {
      dispatch({ type: 'SIGN_OUT' });
    };
    return () => {
      api.onAuthFailure = null;
    };
  }, []);

  useEffect(() => {
    async function restoreSession() {
      const token = await StorageService.getAccessToken().catch(() => null);
      if (!token) {
        dispatch({ type: 'SET_LOADING', isLoading: false });
        return;
      }

      // Restore identity from the stored token + locally cached profile.
      // Throws only on a malformed token (unrecoverable). serverName/serverPhone
      // (from /users/me) win over the local cache when available.
      const restoreFromToken = async (serverName?: string | null, serverPhone?: string | null) => {
        const savedName = await AsyncStorage.getItem('@user_name');
        const savedDob = await AsyncStorage.getItem('@user_dob');
        const savedPhone = await AsyncStorage.getItem('@user_phone');
        const payload = JSON.parse(atob(token.split('.')[1] ?? '')) as {
          sub: string;
          role: string;
        };
        dispatch({
          type: 'RESTORE_TOKEN',
          userId: payload.sub,
          role: payload.role,
          phone: serverPhone ?? savedPhone,
          name: serverName ?? savedName,
          dob: savedDob,
        });
      };

      const endSession = async () => {
        await StorageService.clearTokens();
        dispatch({ type: 'SET_LOADING', isLoading: false });
      };

      try {
        // Liveness probe (refreshes an expired access token) + durable profile:
        // /users/me returns the server-side name and phone, so a reinstall or a
        // new device recovers them instead of re-running profile setup.
        const me = await api.getMe();
        const serverName =
          [me.profile?.firstName, me.profile?.lastName].filter(Boolean).join(' ') || null;
        if (serverName) await AsyncStorage.setItem('@user_name', serverName);
        if (me.phone) await AsyncStorage.setItem('@user_phone', me.phone);
        await restoreFromToken(serverName, me.phone ?? null);
      } catch (err) {
        // Only a real auth rejection (401 after the client's refresh attempt)
        // ends the session. A network failure — offline launch, dead zone —
        // must NOT log the user out: restore optimistically from the cache; the
        // api-client refreshes or signs out properly once requests flow again.
        if (err instanceof ApiError && err.statusCode === 401) {
          await endSession();
          return;
        }
        try {
          await restoreFromToken();
        } catch {
          await endSession(); // malformed token — nothing to restore
        }
      }
    }
    void restoreSession();
  }, []);

  const signIn = async (
    userId: string,
    role: string,
    phone: string,
    name: string | null = null,
  ) => {
    // Cache what the JWT doesn't carry so an (offline) restore still has it.
    if (name) await AsyncStorage.setItem('@user_name', name);
    await AsyncStorage.setItem('@user_phone', phone);
    dispatch({ type: 'SIGN_IN', userId, role, phone, name });
  };

  const updateProfile = async (name: string, dob: string) => {
    // Local first — completing profile setup must never block on the network.
    await AsyncStorage.setItem('@user_name', name);
    await AsyncStorage.setItem('@user_dob', dob);
    dispatch({ type: 'UPDATE_PROFILE', name, dob });

    // Server is the durable copy (survives reinstall / device change). Best
    // effort: on failure the local cache still works and the next login's
    // /users/me hydration reconciles. DOB stays local — no backend column.
    const [firstName = name, ...rest] = name.split(/\s+/);
    try {
      await api.updateMyProfile({
        firstName,
        ...(rest.length > 0 ? { lastName: rest.join(' ') } : {}),
      });
    } catch {
      /* tolerate — cached locally; re-synced on next successful login */
    }
  };

  const signOut = async () => {
    await StorageService.clearTokens();
    await AsyncStorage.multiRemove(['@user_name', '@user_dob', '@user_phone']);
    dispatch({ type: 'SIGN_OUT' });
  };

  return (
    <AuthContext.Provider value={{ state, signIn, signOut, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
