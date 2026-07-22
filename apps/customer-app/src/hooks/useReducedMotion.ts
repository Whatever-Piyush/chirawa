import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// Reports the OS "Reduce Motion" accessibility setting and keeps it live. Used by
// the LiveOrderBubble to drop pulses/springs in favour of instant state changes.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduced;
}
