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
import { isInsideServiceArea, isServiceablePincode, isValidPincode } from '@/lib/serviceArea';

export type LocationChoice = {
  mode: 'gps' | 'pincode';
  lat: number | null;
  lng: number | null;
  pincode: string | null;
  label: string;
  serviceable: boolean;
};

type LocationContextValue = {
  choice: LocationChoice | null;
  ready: boolean; // hydrated from storage (avoids a first-paint gate flash)
  detecting: boolean;
  error: string | null;
  gateOpen: boolean;
  detectViaGps: () => Promise<void>;
  setPincode: (pincode: string) => boolean; // false if syntactically invalid
  clearError: () => void;
  openGate: () => void;
  closeGate: () => void;
};

const LocationContext = createContext<LocationContextValue | undefined>(undefined);

const STORAGE_KEY = 'bringly_location';
const COOKIE_KEY = 'loc';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180; // 180 days

function readStored(): LocationChoice | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocationChoice>;
    if (parsed && (parsed.mode === 'gps' || parsed.mode === 'pincode') && typeof parsed.serviceable === 'boolean') {
      return {
        mode: parsed.mode,
        lat: parsed.lat ?? null,
        lng: parsed.lng ?? null,
        pincode: parsed.pincode ?? null,
        label: parsed.label ?? '',
        serviceable: parsed.serviceable,
      };
    }
  } catch {
    /* corrupt value — treat as no choice */
  }
  return null;
}

function persist(choice: LocationChoice): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    } catch {
      /* ignore quota / private mode */
    }
  }
  if (typeof document !== 'undefined') {
    // Compact cookie (mode + serviceable + pincode) — enough for a future SSR
    // read of the delivery label; full detail stays in localStorage.
    const value = encodeURIComponent(
      JSON.stringify({ m: choice.mode, s: choice.serviceable, p: choice.pincode }),
    );
    document.cookie = `${COOKIE_KEY}=${value};path=/;max-age=${COOKIE_MAX_AGE};samesite=lax`;
  }
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<LocationChoice | null>(null);
  const [ready, setReady] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gateOpen, setGateOpen] = useState(false);

  // Hydrate once after mount (SSR renders no gate → no hydration mismatch).
  useEffect(() => {
    setChoice(readStored());
    setReady(true);
  }, []);

  const commit = useCallback((next: LocationChoice) => {
    setChoice(next);
    persist(next);
    setError(null);
    if (next.serviceable) setGateOpen(false);
  }, []);

  const detectViaGps = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('geolocation-unavailable');
      return;
    }
    setDetecting(true);
    setError(null);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10_000,
          maximumAge: 60_000,
        });
      });
      const { latitude, longitude } = pos.coords;
      const serviceable = isInsideServiceArea(latitude, longitude);
      commit({
        mode: 'gps',
        lat: latitude,
        lng: longitude,
        pincode: null,
        label: 'चिरावा',
        serviceable,
      });
    } catch {
      setError('permission-denied');
    } finally {
      setDetecting(false);
    }
  }, [commit]);

  const setPincode = useCallback(
    (raw: string): boolean => {
      const pincode = raw.trim();
      if (!isValidPincode(pincode)) {
        setError('invalid-pincode');
        return false;
      }
      const serviceable = isServiceablePincode(pincode);
      commit({
        mode: 'pincode',
        lat: null,
        lng: null,
        pincode,
        label: pincode,
        serviceable,
      });
      return true;
    },
    [commit],
  );

  const value = useMemo<LocationContextValue>(
    () => ({
      choice,
      ready,
      detecting,
      error,
      gateOpen,
      detectViaGps,
      setPincode,
      clearError: () => setError(null),
      openGate: () => setGateOpen(true),
      closeGate: () => setGateOpen(false),
    }),
    [choice, ready, detecting, error, gateOpen, detectViaGps, setPincode],
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationContextValue {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used within a LocationProvider');
  return ctx;
}
