'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

// UI-side session state fed by GET /api/auth/session (JWT decoded server-side;
// tokens never reach JS). login/logout flows call refresh() to resync.

export interface WebSession {
  authed: boolean;
  userId: string | null;
  role: string | null;
}

interface AuthValue {
  session: WebSession;
  ready: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const ANON: WebSession = { authed: false, userId: null, role: null };

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<WebSession>(ANON);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/session', { cache: 'no-store' });
      const data = (await r.json()) as { authed?: boolean; userId?: string | null; role?: string | null };
      setSession(
        data.authed
          ? { authed: true, userId: data.userId ?? null, role: data.role ?? null }
          : ANON,
      );
    } catch {
      setSession(ANON);
    } finally {
      setReady(true);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Cookies are cleared server-side; a network blip still ends the UI session.
    }
    setSession(ANON);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ session, ready, refresh, logout }), [session, ready, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
