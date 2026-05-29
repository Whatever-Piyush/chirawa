import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { height: SCREEN_H } = Dimensions.get('window');
const SQUARE = 48;

interface TriggerArgs { x: number; y: number; color: string }
interface FlyCtx { trigger: (args: TriggerArgs) => void }

const Ctx = createContext<FlyCtx | null>(null);

interface Fly { id: number; x: number; y: number; color: string }

// A single flying square that arcs from the source to the cart capsule.
function Flier({
  fly, destX, destY, onDone,
}: { fly: Fly; destX: number; destY: number; onDone: () => void }) {
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const sc = useRef(new Animated.Value(1)).current;
  const op = useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    const dx = destX - fly.x;
    const dy = destY - fly.y;
    Animated.parallel([
      Animated.timing(tx, {
        toValue: dx, duration: 500,
        easing: Easing.bezier(0.25, 0.46, 0.45, 0.94), useNativeDriver: true,
      }),
      // Arc: rise ~60px first, then fall to the cart.
      Animated.sequence([
        Animated.timing(ty, { toValue: -60, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(ty, { toValue: dy, duration: 300, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
      Animated.timing(sc, { toValue: 0.3, duration: 500, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(op, { toValue: 0, duration: 500, delay: 350, useNativeDriver: true }),
    ]).start(() => onDone());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.square,
        {
          left: fly.x - SQUARE / 2,
          top:  fly.y - SQUARE / 2,
          backgroundColor: fly.color,
          opacity: op,
          transform: [{ translateX: tx }, { translateY: ty }, { scale: sc }],
        },
      ]}
    />
  );
}

// Root-level provider. Renders an absolutely-positioned overlay above the app
// so flying squares appear over everything (incl. the tab bar + capsule).
export function FlyToCartProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [flies, setFlies] = useState<Fly[]>([]);
  const idRef = useRef(0);

  const trigger = useCallback(({ x, y, color }: TriggerArgs) => {
    idRef.current += 1;
    const id = idRef.current;
    setFlies((f) => [...f, { id, x, y, color }]);
  }, []);

  const remove = useCallback((id: number) => {
    setFlies((f) => f.filter((x) => x.id !== id));
  }, []);

  // Destination ≈ the capsule's left thumbnail centre (capsule sits at
  // insets.bottom + 64 + 8, height 56 → centre ~100px above the bottom).
  const destX = 16 + 8 + 20;                 // pill left margin + pad + half-thumb
  const destY = SCREEN_H - insets.bottom - 100;

  return (
    <Ctx.Provider value={{ trigger }}>
      {children}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {flies.map((f) => (
          <Flier key={f.id} fly={f} destX={destX} destY={destY} onDone={() => remove(f.id)} />
        ))}
      </View>
    </Ctx.Provider>
  );
}

export function useFlyToCart(): FlyCtx {
  return useContext(Ctx) ?? { trigger: () => {} };
}

const styles = StyleSheet.create({
  square: {
    position:     'absolute',
    width:        SQUARE,
    height:       SQUARE,
    borderRadius: 10,
  },
});
