import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '@chirawa/i18n';
import { OrderStatus } from '@chirawa/types';
import { Text, PressableScale } from '../../components/ui';
import { Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import type { ActiveOrderEntry } from '../../hooks/useActiveOrders';

// At most two cards on Home; further active orders collapse into a "view all"
// row that lands on the orders tab (where every order has its Track button).
const MAX_CARDS = 2;

// 9 DB statuses → the tracking screen's 5 display phases (same collapse as
// STATUS_STEP5 there); terminal statuses never reach this component.
const PHASE_INDEX: Partial<Record<OrderStatus, number>> = {
  [OrderStatus.PENDING_PAYMENT]:  0,
  [OrderStatus.PAID]:             0,
  [OrderStatus.CONFIRMED]:        0,
  [OrderStatus.PREPARING]:        1,
  [OrderStatus.READY_FOR_PICKUP]: 1,
  [OrderStatus.PICKED_UP]:        2,
  [OrderStatus.OUT_FOR_DELIVERY]: 3,
};
const PHASE_EMOJI     = ['✅', '👨‍🍳', '🛵', '🛵'];
const PHASE_LABEL_KEY = ['tracking.confirmed', 'tracking.preparing', 'tracking.pickedUp', 'tracking.onTheWay'];
const SEGMENTS = 5; // confirmed · packing · picked up · on the way · delivered

interface Props {
  entries:        ActiveOrderEntry[];
  onPressEntry:   (entry: ActiveOrderEntry) => void;
  onPressViewAll: () => void;
}

function OrderCard({
  entry, onPress, t, Colors, styles,
}: {
  entry: ActiveOrderEntry;
  onPress: () => void;
  t: (key: string) => string;
  Colors: ColorPalette;
  styles: ReturnType<typeof makeStyles>;
}) {
  const idx      = PHASE_INDEX[entry.status] ?? 0;
  const emoji    = PHASE_EMOJI[idx] ?? '✅';
  const label    = t(PHASE_LABEL_KEY[idx] ?? 'tracking.confirmed');
  const orderRef = `#${(entry.groupId ?? entry.orderId).slice(-6).toUpperCase()}`;
  const rupees   = Math.round(entry.totalPaise / 100);
  const middle   = entry.orderCount > 1
    ? `${entry.orderCount} ${t('home.activeOrderShops')}`
    : `${entry.itemCount} ${t('history.items')}`;

  return (
    <PressableScale
      onPress={onPress}
      style={styles.card}
      scaleTo={0.97}
      accessibilityLabel={`${label} — ${t('home.activeOrderTrack')}`}
    >
      <View style={styles.emojiWrap}>
        <Text style={styles.emoji}>{emoji}</Text>
      </View>

      <View style={styles.mid}>
        <Text weight="bold" color={Colors.textPrimary} style={styles.title} numberOfLines={1}>
          {label}
        </Text>
        <Text weight="medium" color={Colors.textSecondary} style={styles.sub} numberOfLines={1}>
          {orderRef}  ·  {middle}  ·  ₹{rupees}
        </Text>
        <View style={styles.track}>
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <View key={i} style={[styles.seg, i <= idx && styles.segDone]} />
          ))}
        </View>
      </View>

      <View style={styles.trackPill}>
        <Text weight="bold" color={Colors.white} style={styles.trackPillText}>
          {t('home.activeOrderTrack')}
        </Text>
        <Ionicons name="chevron-forward" size={13} color={Colors.white} />
      </View>
    </PressableScale>
  );
}

// "Order in flight" cards pinned to the top of Home — the always-there way back
// into tracking, no matter how the customer left the app. Data (and the
// auto-disappear on delivered/cancelled) comes from useActiveOrders.
export default function ActiveOrdersStrip({ entries, onPressEntry, onPressViewAll }: Props) {
  const t = useT();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  // Gentle entrance when the strip appears (matches Home's header/search intro).
  const opacity = useRef(new Animated.Value(0)).current;
  const shift   = useRef(new Animated.Value(12)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.timing(shift,   { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start();
  }, [opacity, shift]);

  if (entries.length === 0) return null;

  const visible = entries.slice(0, MAX_CARDS);
  const hidden  = entries.length - visible.length;

  return (
    <Animated.View style={[styles.wrap, { opacity, transform: [{ translateY: shift }] }]}>
      {visible.map((entry) => (
        <OrderCard
          key={entry.key}
          entry={entry}
          onPress={() => onPressEntry(entry)}
          t={t}
          Colors={Colors}
          styles={styles}
        />
      ))}

      {hidden > 0 && (
        <PressableScale
          onPress={onPressViewAll}
          style={styles.moreRow}
          scaleTo={0.97}
          accessibilityLabel={t('home.activeOrderViewAll')}
        >
          <Text weight="bold" color={Colors.primary} style={styles.moreText}>
            {t('home.activeOrderViewAll')} (+{hidden})
          </Text>
          <Ionicons name="chevron-forward" size={14} color={Colors.primary} />
        </PressableScale>
      )}
    </Animated.View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    // HPAD 16 matches the rest of the home sections.
    wrap: { paddingHorizontal: 16, marginTop: Spacing.md, gap: Spacing.sm },

    card: {
      flexDirection:   'row',
      alignItems:      'center',
      gap:             Spacing.md,
      backgroundColor: Colors.card,
      borderRadius:    Radius.lg,
      padding:         Spacing.md,
      ...Shadow.card,
    },
    emojiWrap: {
      width: 44, height: 44, borderRadius: 14,
      backgroundColor: Colors.primaryLight,
      alignItems: 'center', justifyContent: 'center',
    },
    emoji: { fontSize: 22, lineHeight: 28 },

    mid:   { flex: 1 },
    title: { fontSize: 15.5, letterSpacing: -0.2 },
    sub:   { fontSize: 12.5, marginTop: 1 },
    track: { flexDirection: 'row', gap: 4, marginTop: 8 },
    seg: {
      flex: 1, height: 4, borderRadius: 2,
      backgroundColor: Colors.surfaceAlt,
    },
    segDone: { backgroundColor: Colors.primary },

    trackPill: {
      flexDirection: 'row', alignItems: 'center', gap: 2,
      backgroundColor: Colors.primary,
      borderRadius: Radius.full,
      paddingLeft: 12, paddingRight: 8, paddingVertical: 7,
    },
    trackPillText: { fontSize: 12.5 },

    moreRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
      paddingVertical: Spacing.sm,
      borderRadius: Radius.md,
      backgroundColor: Colors.primaryLight,
    },
    moreText: { fontSize: 13 },
  });
