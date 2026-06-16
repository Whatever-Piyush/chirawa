import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlacePrediction, PlaceDetailsResult } from '@chirawa/types';
import { api } from '../../services/api.service';

// RFC4122-ish v4 token — opaque per-session id for Google's billing grouping.
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const MIN_CHARS = 3;
const DEBOUNCE_MS = 250;

// Chirawa-restricted place search. One session token spans a search session's
// autocomplete calls + the final placeDetails (cheaper, per Google guidance);
// a fresh token starts after each pick.
export function usePlaceSearch() {
  const [query, setQuery] = useState('');
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [searching, setSearching] = useState(false);

  const sessionRef = useRef<string>(uuidv4());
  const seqRef = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      setPredictions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++seqRef.current;
    const handle = setTimeout(async () => {
      try {
        const preds = await api.autocompletePlaces(q, sessionRef.current);
        if (seq === seqRef.current) setPredictions(preds);
      } catch {
        if (seq === seqRef.current) setPredictions([]);
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  // Resolve a chosen prediction → coords + clean address, then rotate the token.
  const resolve = useCallback(async (placeId: string): Promise<PlaceDetailsResult | null> => {
    const details = await api.placeDetails(placeId, sessionRef.current);
    sessionRef.current = uuidv4();
    return details;
  }, []);

  const reset = useCallback(() => {
    setQuery('');
    setPredictions([]);
    seqRef.current++;
    sessionRef.current = uuidv4();
  }, []);

  return { query, setQuery, predictions, searching, resolve, reset, active: query.trim().length >= MIN_CHARS };
}
