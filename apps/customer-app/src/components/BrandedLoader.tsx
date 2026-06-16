import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Easing, AccessibilityInfo, type ViewStyle, type TextStyle } from 'react-native';
import { Text, FauxGradient, DotsLoader } from './ui';
import { Spacing } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { useStoreClosed } from '../hooks/useStoreClosed';
import { NIGHT_FROM, NIGHT_TO } from '../screens/home/nightTheme';
import Starfield from '../screens/home/Starfield';
import BringlyBag from './illustrations/BringlyBag';

// ─── Branded full-page loader (LOADING_ANIMATION.md) ─────────────────────────
// Premium buffer screen: the Bringly grocery-bag brand illustration with a calm
// float + breathe, a dots indicator, and a tagline — skinned in our theme
// (cream/orange by day, the night-space look when the store is closed). Pure RN
// Animated (no new deps). Honours OS "reduce motion".

const NIGHT_STARS: TextStyle[] = [
  { top: '30%', left: '18%', fontSize: 8, opacity: 0.6 },
  { top: '26%', left: '74%', fontSize: 6, opacity: 0.5, color: '#BFD0FF' },
  { top: '38%', left: '42%', fontSize: 5, opacity: 0.4 },
  { top: '44%', left: '84%', fontSize: 7, opacity: 0.5 },
  { top: '34%', left: '60%', fontSize: 4, opacity: 0.35, color: '#E2D2FF' },
  { top: '50%', left: '12%', fontSize: 6, opacity: 0.45 },
  { top: '22%', left: '50%', fontSize: 5, opacity: 0.4, color: '#FFF1C9' },
  { top: '54%', left: '70%', fontSize: 8, opacity: 0.55 },
];

interface Props {
  message?: string;
  style?:   ViewStyle;
}

export default function BrandedLoader({ message, style }: Props) {
  const { colors: Colors } = useTheme();
  const closed = useStoreClosed();

  // Respect the OS "reduce motion" setting → hold the bag still.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => { if (mounted) setReduceMotion(!!v); })
      .catch(() => { /* default: animate */ });
    return () => { mounted = false; };
  }, []);

  // Calm float + breathe loop (premium, not busy).
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [float, reduceMotion]);

  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });
  const scale      = float.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });

  const tagline = message ?? 'Everything you need, in minutes';

  return (
    <View style={[styles.container, { backgroundColor: Colors.background }, style]}>
      {closed && (
        <>
          <FauxGradient from={NIGHT_FROM} to={NIGHT_TO} steps={16} style={StyleSheet.absoluteFill} />
          <Starfield stars={NIGHT_STARS} />
        </>
      )}

      <Animated.View style={{ transform: [{ translateY }, { scale }] }}>
        <BringlyBag size={148} />
      </Animated.View>

      <DotsLoader color={closed ? '#FFFFFF' : Colors.primary} size={7} style={{ marginTop: Spacing.xl }} />

      <Text
        weight="medium"
        align="center"
        color={closed ? 'rgba(255,255,255,0.85)' : Colors.textSecondary}
        style={styles.tagline}
      >
        {tagline}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  tagline:   { fontSize: 15, lineHeight: 21, marginTop: Spacing.md, maxWidth: 260 },
});
