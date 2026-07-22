import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Keyboard, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { OrderStatus } from '@chirawa/types';
import { useT } from '@chirawa/i18n';
import { Text } from './ui';
import { Radius, Shadow, Spacing } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { useCart } from '../context/CartContext';
import { useActiveOrdersContext } from '../context/ActiveOrdersContext';
import { navigationRef } from '../navigation/ref';
import { useReducedMotion } from '../hooks/useReducedMotion';
import type { ActiveOrderEntry } from '../hooks/useActiveOrders';
import {
  resolveLiveOrderState,
  filledTicks,
  selectFeatured,
  activeCount,
  TOTAL_TICKS,
  type LiveTone,
} from '../utils/liveOrder';
import { BUBBLE_ROUTES, bubbleBottomOffset, cartPillVisible } from './dockGeometry';
import { track } from '../services/analytics.service';
import LiveOrderDial from './LiveOrderDial';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const DISC = 64;              // the floating "coin" (dial ring)
const CORE = 48;              // the coloured status core
const CELEBRATE_MS = 1600;    // how long the delivered celebration holds before dismiss

// ── Live Order Bubble (Track_Order.md) ───────────────────────────────────────
// A premium, always-present floating tracker in the bottom-right corner. Reads
// the shared active-orders feed (one socket app-wide), self-hides when there is
// nothing in flight, stacks above the CartDockPill, and opens tracking in a tap.
function LiveOrderBubble({ activeRoute }: { activeRoute?: string }) {
  const insets = useSafeAreaInsets();
  const t = useT();
  const { colors } = useTheme();
  const { count: cartCount } = useCart();
  const { entries, connected, justDelivered } = useActiveOrdersContext();
  const reduced = useReducedMotion();

  const featured = selectFeatured<ActiveOrderEntry>(entries);
  const count = activeCount(entries);

  // Delivered celebration: a `delivered` socket event lands just before the order
  // leaves the list, so we flash a green success state before the bubble dismisses.
  const [celebrating, setCelebrating] = useState(false);
  const featuredRef = useRef(featured);
  featuredRef.current = featured;
  const countRef = useRef(count);
  countRef.current = count;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const handledDeliveredAt = useRef(0);

  useEffect(() => {
    if (!justDelivered || justDelivered.at === handledDeliveredAt.current) return;
    handledDeliveredAt.current = justDelivered.at;
    const f = featuredRef.current;
    // Only celebrate the clean "your last order just arrived" case — never
    // misattribute a delivered child of a group or a background order.
    if (f && f.orderId === justDelivered.orderId && countRef.current <= 1) {
      setCelebrating(true);
      if (!reducedRef.current) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      track('order_delivered_viewed', { orderId: justDelivered.orderId });
      const id = setTimeout(() => {
        setCelebrating(false);
        track('bubble_dismissed', { orderId: justDelivered.orderId });
      }, CELEBRATE_MS);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [justDelivered]);

  // Visual state: delivered while celebrating, otherwise the featured order's
  // phase. Cached so the exit animation still has something to render.
  const baseState = useMemo(() => {
    if (celebrating) return resolveLiveOrderState(OrderStatus.DELIVERED);
    return featured ? resolveLiveOrderState(featured.status) : null;
  }, [celebrating, featured]);
  const lastStateRef = useRef(baseState);
  if (baseState) lastStateRef.current = baseState;
  const renderState = baseState ?? lastStateRef.current;

  // Keyboard visibility — hide the bubble while typing (avoids a mid-screen float
  // on Android's resize and collisions with input accessories on iOS).
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, () => setKeyboardOpen(true));
    const h = Keyboard.addListener(hideEvt, () => setKeyboardOpen(false));
    return () => { s.remove(); h.remove(); };
  }, []);

  const routeAllowed = BUBBLE_ROUTES.has(activeRoute ?? 'Home');
  const offline = !connected && !celebrating;
  const shouldShow = routeAllowed && !keyboardOpen && (celebrating || featured != null);

  // ── Animations ─────────────────────────────────────────────────────────────
  const mount      = useRef(new Animated.Value(0)).current; // appearance / dismiss
  const pressScale = useRef(new Animated.Value(1)).current; // press bounce
  const popScale   = useRef(new Animated.Value(1)).current; // status-change pop
  const pulse      = useRef(new Animated.Value(0)).current; // live halo
  const [rendered, setRendered] = useState(false);

  // Appear / dismiss.
  useEffect(() => {
    if (shouldShow) {
      if (!rendered) setRendered(true);
      if (reduced) { mount.setValue(1); return; }
      Animated.spring(mount, { toValue: 1, tension: 200, friction: 18, useNativeDriver: true }).start();
    } else if (rendered) {
      track('bubble_hidden', { reason: !routeAllowed ? 'route' : keyboardOpen ? 'keyboard' : 'inactive' });
      if (reduced) { mount.setValue(0); setRendered(false); return; }
      Animated.timing(mount, { toValue: 0, duration: 220, useNativeDriver: true })
        .start(({ finished }) => { if (finished) setRendered(false); });
    }
  }, [shouldShow, rendered, reduced, routeAllowed, keyboardOpen, mount]);

  // Live pulse — paused when idle, offline, or Reduce Motion is on. Slightly
  // faster once the order is out for delivery ("closer").
  const step = renderState?.step ?? null;
  useEffect(() => {
    const active = rendered && shouldShow && !reduced && !offline;
    if (!active) { pulse.stopAnimation(); pulse.setValue(0); return; }
    const cadence = step === 3 ? 1200 : 1800;
    pulse.setValue(0);
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: cadence, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [rendered, shouldShow, reduced, offline, step, pulse]);

  // Pop the core on each real phase change.
  const prevStep = useRef<number | null>(null);
  useEffect(() => {
    if (prevStep.current !== null && step !== null && step !== prevStep.current && !reduced) {
      Animated.sequence([
        Animated.timing(popScale, { toValue: 1.12, duration: 130, useNativeDriver: true }),
        Animated.spring(popScale, { toValue: 1, tension: 300, friction: 10, useNativeDriver: true }),
      ]).start();
    }
    prevStep.current = step;
  }, [step, reduced, popScale]);

  // Viewed analytics — once per order+phase surfaced.
  const viewedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!shouldShow || !featured || step === null) return;
    const key = `${featured.orderId}:${step}`;
    if (viewedKey.current === key) return;
    viewedKey.current = key;
    track('tracking_bubble_viewed', { orderId: featured.orderId, phase: step, activeCount: count });
    if (count >= 2) track('multiple_orders_viewed', { activeCount: count });
  }, [shouldShow, featured, step, count]);

  if (!rendered || !renderState) return null;

  const toneColor = toneToColor(renderState.tone, colors);
  const filled = celebrating ? TOTAL_TICKS : filledTicks(renderState.step);
  const caption = offline ? t('liveOrder.reconnecting') : t(renderState.captionKey);
  const a11yLabel = count >= 2
    ? t('liveOrder.a11yMulti').replace('{count}', String(count))
    : t('liveOrder.a11ySingle').replace('{status}', caption);

  const bottom = bubbleBottomOffset(activeRoute, insets.bottom, cartPillVisible(activeRoute, cartCount));
  const translateY  = mount.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });
  const appearScale = mount.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] });
  const haloScale   = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0] });

  const onPress = () => {
    if (!reduced) {
      Animated.sequence([
        Animated.timing(pressScale, { toValue: 0.9, duration: 80, useNativeDriver: true }),
        Animated.timing(pressScale, { toValue: 1, duration: 120, useNativeDriver: true }),
      ]).start();
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    track('tracking_bubble_pressed', { orderId: featured?.orderId, phase: step ?? undefined, activeCount: count });
    if (!navigationRef.isReady()) return;
    if (count >= 2) {
      navigationRef.navigate('MainTabs', { screen: 'OrderHistory' });
      track('tracking_opened', { source: 'bubble', activeCount: count });
    } else if (featured) {
      navigationRef.navigate('OrderTracking', featured.groupId
        ? { orderId: featured.orderId, groupId: featured.groupId }
        : { orderId: featured.orderId });
      track('tracking_opened', { source: 'bubble', orderId: featured.orderId, groupId: featured.groupId });
    }
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom, right: Spacing.lg, opacity: mount, transform: [{ translateY }, { scale: appearScale }] }]}
    >
      {/* Non-interactive: never blocks touches to the content behind it. Text
          uses textPrimary (not the tone) so warning/yellow stays AA-legible. */}
      <View pointerEvents="none" style={[styles.caption, { backgroundColor: colors.surface }]}>
        <Text weight="semibold" numberOfLines={1} style={[styles.captionText, { color: colors.textPrimary }]}>
          {caption}
        </Text>
      </View>

      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.touch}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityLiveRegion="polite"
      >
        {!offline && (
          <Animated.View
            pointerEvents="none"
            style={[styles.halo, { backgroundColor: toneColor, opacity: haloOpacity, transform: [{ scale: haloScale }] }]}
          />
        )}

        <View style={[styles.disc, { backgroundColor: colors.surface, shadowColor: toneColor }]}>
          <LiveOrderDial filled={filled} diameter={DISC} filledColor={toneColor} trackColor={colors.surfaceAlt} />
          <Animated.View style={[styles.core, { backgroundColor: toneColor, transform: [{ scale: pressScale }, { scale: popScale }] }]}>
            <Ionicons name={renderState.icon as IconName} size={22} color={colors.white} />
          </Animated.View>
        </View>

        {count > 1 && (
          <View style={[styles.badge, { backgroundColor: colors.surface, borderColor: toneColor }]}>
            <Text weight="bold" style={[styles.badgeText, { color: toneColor }]}>{count}</Text>
          </View>
        )}

        {offline && <View style={[styles.offlineDot, { backgroundColor: colors.textTertiary, borderColor: colors.surface }]} />}
      </TouchableOpacity>
    </Animated.View>
  );
}

function toneToColor(tone: LiveTone, colors: ReturnType<typeof useTheme>['colors']): string {
  if (tone === 'success') return colors.success;
  if (tone === 'warning') return colors.warning;
  return colors.primary;
}

// Memoized: AppNavigator re-renders on every navigation (activeRoute changes) and
// on theme changes; live data flows in via context, so re-render only when the
// route prop actually changes.
export default memo(LiveOrderBubble);

const styles = StyleSheet.create({
  wrap:  { position: 'absolute', alignItems: 'flex-end' },
  caption: {
    paddingHorizontal: 10,
    paddingVertical:   4,
    borderRadius:      Radius.full,
    marginBottom:      8,
    maxWidth:          170,
    ...Shadow.sm,
  },
  captionText: { fontSize: 11, lineHeight: 14 },
  touch: { width: DISC, height: DISC, alignItems: 'center', justifyContent: 'center' },
  halo:  { position: 'absolute', width: DISC, height: DISC, borderRadius: DISC / 2 },
  disc: {
    width:          DISC,
    height:         DISC,
    borderRadius:   DISC / 2,
    alignItems:     'center',
    justifyContent: 'center',
    shadowOpacity:  0.3,
    shadowRadius:   14,
    shadowOffset:   { width: 0, height: 6 },
    elevation:      12,
  },
  core: {
    width:          CORE,
    height:         CORE,
    borderRadius:   CORE / 2,
    alignItems:     'center',
    justifyContent: 'center',
  },
  badge: {
    position:       'absolute',
    top:            -2,
    right:          -2,
    minWidth:       18,
    height:         18,
    borderRadius:   9,
    borderWidth:    1.5,
    paddingHorizontal: 3,
    alignItems:     'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, lineHeight: 12 },
  offlineDot: {
    position:    'absolute',
    top:         0,
    left:        0,
    width:       12,
    height:      12,
    borderRadius: 6,
    borderWidth: 2,
  },
});
