import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '@chirawa/i18n';
import { Text, FauxGradient } from './ui';
import { Colors, Spacing } from '../theme';
import { useCart } from '../context/CartContext';
import { isOpenNow } from '../utils/operatingHours';
import { navigationRef } from '../navigation/ref';
import { NIGHT_FROM, NIGHT_TO } from '../screens/home/nightTheme';
import Starfield from '../screens/home/Starfield';
import CartThumbs from './CartThumbs';
import type { TextStyle } from 'react-native';
// Floating-dock geometry is shared with the LiveOrderBubble so the two never
// overlap (Track_Order.md · Placement). The route allowlist / offsets moved here
// unchanged — the pill's behaviour is identical.
import { CART_TAB_ROUTES, TAB_BAR_BASE, GAP_ABOVE_BAR, STACK_GAP, PRODUCT_BAR, cartPillVisible } from './dockGeometry';

// A few tiny stars for the cart pill's night look (matches header/banner).
const CART_STARS: TextStyle[] = [
  { top: 6,  left: 70,   fontSize: 6, opacity: 0.5 },
  { top: 14, left: 130,  fontSize: 5, opacity: 0.4 },
  { top: 8,  right: 90,  fontSize: 7, opacity: 0.5, color: '#BFD0FF' },
  { bottom: 8,  left: 100, fontSize: 5, opacity: 0.4 },
  { bottom: 10, right: 120,fontSize: 6, opacity: 0.45 },
];

// Floating cart capsule. Hidden when the cart is empty; slides up on every screen
// the moment an item is added. Left side stacks circular thumbnails of the last 3
// added items (animated); brand orange by day, night-themed when the store closes.
export default function CartDockPill({ activeRoute }: { activeRoute?: string }) {
  const insets = useSafeAreaInsets();
  const t = useT();
  const { count, subtotalPaise, recentlyAdded } = useCart();
  // Night theme when closed — re-checked on navigation (activeRoute) + every min.
  const [closed, setClosed] = useState(!isOpenNow());
  useEffect(() => {
    setClosed(!isOpenNow());
    const id = setInterval(() => setClosed(!isOpenNow()), 60_000);
    return () => clearInterval(id);
  }, [activeRoute]);

  // Show only when the cart has items AND we're on a browse/shop surface (a tab or
  // a pushed shopping screen). Undefined route = first paint on Home → allow.
  const shouldShow = cartPillVisible(activeRoute, count);

  const anim  = useRef(new Animated.Value(shouldShow ? 1 : 0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const prevCount = useRef(count);
  const [rendered, setRendered] = useState(shouldShow);

  // Show / hide on visibility changes.
  useEffect(() => {
    if (shouldShow) {
      if (!rendered) setRendered(true);
      Animated.spring(anim, { toValue: 1, tension: 200, friction: 18, useNativeDriver: true }).start();
    } else if (rendered) {
      Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true })
        .start(({ finished }) => { if (finished) setRendered(false); });
    }
  }, [shouldShow, rendered, anim]);

  // Little bump when the count changes.
  useEffect(() => {
    const prev = prevCount.current;
    prevCount.current = count;
    if (prev > 0 && prev !== count) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.05, duration: 60, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, tension: 300, friction: 10, useNativeDriver: true }),
      ]).start();
    }
  }, [count, scale]);

  if (!rendered) return null;

  const onTab     = !activeRoute || CART_TAB_ROUTES.has(activeRoute);
  const bottom    = onTab
    ? insets.bottom + TAB_BAR_BASE + GAP_ABOVE_BAR
    : activeRoute === 'ProductDetail'
      ? insets.bottom + PRODUCT_BAR
      : insets.bottom + STACK_GAP;

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [90, 0] });
  const rupees     = Math.round(subtotalPaise / 100);
  const itemsWord  = count === 1 ? t('cart.itemOne') : t('cart.itemMany');

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom, opacity: anim, transform: [{ translateY }, { scale }] }]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        style={[styles.pill, closed && styles.pillNight]}
        onPress={() => { if (navigationRef.isReady()) navigationRef.navigate('Checkout'); }}
        accessibilityRole="button"
        accessibilityLabel={t('cart.viewCart')}
      >
        {/* Night theme when closed — self-rounded gradient so the shadow survives. */}
        {closed && (
          <>
            <FauxGradient from={NIGHT_FROM} to={NIGHT_TO} steps={12} style={[StyleSheet.absoluteFill, { borderRadius: 24 }]} />
            <Starfield stars={CART_STARS} />
          </>
        )}

        {/* Left — stacked thumbnails of the last 3 added items still in the cart */}
        <View style={styles.left}>
          <CartThumbs items={recentlyAdded} />
        </View>

        {/* Center — view cart + summary */}
        <View style={styles.center}>
          <Text weight="bold" color={Colors.white} style={styles.title}>
            {t('cart.viewCart')}
          </Text>
          <Text weight="medium" style={styles.summary}>
            {count} {itemsWord}  ·  ₹{rupees}
          </Text>
        </View>

        {/* Right — circular chevron */}
        <View style={styles.chevron}>
          <Ionicons name="chevron-forward" size={18} color={closed ? NIGHT_FROM : Colors.primary} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position:   'absolute',
    left:       Spacing.lg,
    right:      Spacing.lg,
    alignItems: 'center',     // centre the content-hugging pill
  },
  pill: {
    flexDirection:   'row',
    alignItems:      'center',
    alignSelf:       'center',
    minWidth:        190,
    height:          48,
    borderRadius:    24,
    backgroundColor: Colors.primary,   // brand orange — matches header/banner
    paddingLeft:     8,
    paddingRight:    6,
    shadowColor:   Colors.primary,
    shadowOpacity: 0.40,
    shadowRadius:  12,
    shadowOffset:  { width: 0, height: 5 },
    elevation:     12,
  },
  pillNight: {
    backgroundColor: NIGHT_FROM,       // night base behind the gradient
    shadowColor:     '#150F2E',
  },
  left: { justifyContent: 'center', minHeight: 30 },
  center: { flex: 1, marginLeft: Spacing.sm, marginRight: Spacing.sm, justifyContent: 'center' },
  title:   { fontSize: 14, lineHeight: 18 },
  summary: { fontSize: 11, lineHeight: 14, color: 'rgba(255,255,255,0.9)', marginTop: 1 },
  chevron: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: Colors.white,
    justifyContent: 'center', alignItems: 'center',
  },
});
