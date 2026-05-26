import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../../theme';

type ToastType = 'success' | 'error' | 'info';

interface ToastConfig {
  message: string;
  type:    ToastType;
}

interface ToastContextType {
  show: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastConfig | null>(null);
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity    = useRef(new Animated.Value(0)).current;
  const hideTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -120, duration: 220, useNativeDriver: true }),
      Animated.timing(opacity,    { toValue: 0,    duration: 220, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }, [translateY, opacity]);

  const show = useCallback((message: string, type: ToastType = 'success') => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setToast({ message, type });
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 280, useNativeDriver: true }),
      Animated.timing(opacity,    { toValue: 1, duration: 280, useNativeDriver: true }),
    ]).start();
    hideTimer.current = setTimeout(hide, 2000);
  }, [translateY, opacity, hide]);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  const bg =
    toast?.type === 'error' ? Colors.error :
    toast?.type === 'info'  ? Colors.secondary :
    Colors.accent;

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.wrap,
            { top: insets.top + Spacing.sm, opacity, transform: [{ translateY }] },
          ]}
        >
          <View style={[styles.toast, { backgroundColor: bg }]}>
            <Text style={styles.text}>{toast.message}</Text>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Safe no-op fallback if used outside the provider — prevents crash
    return { show: () => undefined };
  }
  return ctx;
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left:  Spacing.lg,
    right: Spacing.lg,
    zIndex: 9999,
    alignItems: 'center',
  },
  toast: {
    paddingHorizontal: Spacing.lg,
    paddingVertical:   Spacing.md,
    borderRadius:      Radius.full,
    minWidth: '70%',
    alignItems: 'center',
    ...Shadow.card,
  },
  text: {
    color: Colors.white,
    fontWeight: '700',
    fontSize: FontSize.md,
    textAlign: 'center',
  },
});
