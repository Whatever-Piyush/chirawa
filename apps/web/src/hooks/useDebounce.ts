'use client';

import { useEffect, useState } from 'react';

// Returns `value` after it has been stable for `delayMs` (suggest-as-you-type).
export function useDebounce<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
