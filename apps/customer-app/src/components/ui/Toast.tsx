import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, Platform, StatusBar, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '../../theme';
import Text from './Text';

export type ToastVariant = 'success' | 'error' | 'info';

interface ToastConfig {
  message: string;
  type:    ToastVariant;
}

interface ToastContextType {
  show: (message: string, type?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

const VARIANT_BG: Record<ToastVariant, string> = {
  success: Colors.success,
  error:   Colors.error,
  info:    Colors.info,
};

const AUTO_DISMISS_MS = 2500;

// Mounted above SafeAreaProvider per global provider order, so insets may be 0.
// Use platform fallback to keep the toast clear of notches/status bar.
const ANDROID_FALLBACK = StatusBar.currentHeight ?? 24;
const IOS_FALLBACK     = 44;
const TOP_FALLBACK     = Platform.OS === 'ios' ? IOS_FALLBACK : ANDROID_FALLBACK;

export function ToastProvider({ children }: { children: ReactNode }) {
  const insets    = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastConfig | null>(null);
  const translateY = useRef(new Animated.Value(-140)).current;
  const opacity    = useRef(new Animated.Value(0)).current;
  const hideTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue:         -140,
        friction:        9,
        tension:         180,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue:         0,
        duration:        220,
        useNativeDriver: true,
      }),
    ]).start(() => setToast(null));
  }, [translateY, opacity]);

  const show = useCallback(
    (message: string, type: ToastVariant = 'success') => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setToast({ message, type });
      Animated.parallel([
        Animated.spring(translateY, {
          toValue:         0,
          friction:        7,
          tension:         140,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue:         1,
          duration:        220,
          useNativeDriver: true,
        }),
      ]).start();
      hideTimer.current = setTimeout(hide, AUTO_DISMISS_MS);
    },
    [translateY, opacity, hide],
  );

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.wrap,
            {
              top:       Math.max(insets.top, TOP_FALLBACK) + Spacing.sm,
              opacity,
              transform: [{ translateY }],
            },
          ]}
        >
          <View
            style={[
              styles.toast,
              { backgroundColor: VARIANT_BG[toast.type] },
            ]}
          >
            <Text
              variant="bodySmall"
              color={Colors.textInverse}
              align="center"
              style={styles.text}
            >
              {toast.message}
            </Text>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Safe no-op fallback if used outside the provider — prevents crash in dev tools
    return { show: () => undefined };
  }
  return ctx;
}

const styles = StyleSheet.create({
  wrap: {
    position:   'absolute',
    left:       Spacing.lg,
    right:      Spacing.lg,
    zIndex:     9999,
    alignItems: 'center',
  },
  toast: {
    paddingHorizontal: Spacing.lg,
    paddingVertical:   Spacing.md,
    borderRadius:      Radius.full,
    minWidth:          '70%',
    alignItems:        'center',
    ...Shadow.md,
  },
  text: {
    fontSize:   FontSize.md,
    fontWeight: FontWeight.bold,
  },
});
