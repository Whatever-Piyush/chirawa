import { useEffect, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { isOpenNow } from '../utils/operatingHours';

// Returns true while the store is closed (outside delivery hours). Re-checks on
// screen focus and on a 1-min interval, so the closed UI flips back to normal at
// opening time even if a screen is left open across the boundary. setState bails
// on unchanged values, so it only re-renders at the actual open↔close transition.
export function useStoreClosed(): boolean {
  const focused = useIsFocused();
  const [closed, setClosed] = useState(!isOpenNow());

  useEffect(() => {
    setClosed(!isOpenNow());
    const id = setInterval(() => setClosed(!isOpenNow()), 60_000);
    return () => clearInterval(id);
  }, [focused]);

  return closed;
}
