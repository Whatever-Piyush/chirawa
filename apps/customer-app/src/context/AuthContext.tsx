import React, { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react';
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
  | { type: 'RESTORE_TOKEN'; userId: string; role: string; name: string | null; dob: string | null }
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
  signIn: (userId: string, role: string, phone: string, name?: string) => void;
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
      try {
        const token = await StorageService.getAccessToken();
        if (token) {
          await api.getShops();
          // Fetch saved name/dob from local storage so it persists on reload
          const savedName = await AsyncStorage.getItem('@user_name');
          const savedDob = await AsyncStorage.getItem('@user_dob');

          const payload = JSON.parse(atob(token.split('.')[1] ?? '')) as {
            sub: string;
            role: string;
          };
          dispatch({
            type: 'RESTORE_TOKEN',
            userId: payload.sub,
            role: payload.role,
            name: savedName,
            dob: savedDob,
          });
        } else {
          dispatch({ type: 'SET_LOADING', isLoading: false });
        }
      } catch {
        await StorageService.clearTokens();
        dispatch({ type: 'SET_LOADING', isLoading: false });
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
    // If your backend already returns a name on login, pass it here
    if (name) await AsyncStorage.setItem('@user_name', name);
    dispatch({ type: 'SIGN_IN', userId, role, phone, name });
  };

  const updateProfile = async (name: string, dob: string) => {
    // 🔴 TODO: Call your backend API here to save the profile! (e.g., await api.updateUserProfile({ name, dob }))
    await AsyncStorage.setItem('@user_name', name);
    await AsyncStorage.setItem('@user_dob', dob);
    dispatch({ type: 'UPDATE_PROFILE', name, dob });
  };

  const signOut = async () => {
    await StorageService.clearTokens();
    await AsyncStorage.multiRemove(['@user_name', '@user_dob']);
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
