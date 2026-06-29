import React, { useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Animated, Easing, TouchableOpacity, BackHandler } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useT } from '@chirawa/i18n';
import { Text } from '../../components/ui';
import { FontSize, FontWeight, MIN_TAP, Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import type { RootStackParamList } from '../../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'OrderPlaced'>;

const AUTO_ADVANCE_MS = 2000;

export default function OrderPlacedScreen({ navigation, route }: Props) {
  const { orderId, groupId, shops, totalAmount } = route.params;
  // Multi-shop: the cart was split into one order per shop. Show the per-shop
  // breakdown + grand total so the customer sees exactly what went where.
  const isGroup = !!groupId && !!shops && shops.length > 1;
  const t = useT();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  // Animations: ring pulse outward, badge springs in, check draws, text fades up.
  const badgeScale = useRef(new Animated.Value(0)).current;
  const ringScale  = useRef(new Animated.Value(0)).current;
  const ringOpacity = useRef(new Animated.Value(0.5)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textShift   = useRef(new Animated.Value(16)).current;

  const goToTracking = () =>
    navigation.replace('OrderTracking', groupId ? { orderId, groupId } : { orderId });

  useEffect(() => {
    Animated.sequence([
      Animated.spring(badgeScale, { toValue: 1, tension: 90, friction: 7, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(textOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(textShift, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
    ]).start();

    // Expanding ring pulse (loops twice-ish before we advance).
    Animated.loop(
      Animated.parallel([
        Animated.timing(ringScale, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(ringOpacity, { toValue: 0, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();

    const id = setTimeout(goToTracking, AUTO_ADVANCE_MS);
    // Block hardware back during the celebration; it auto-advances to tracking.
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => { clearTimeout(id); sub.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ring = {
    transform: [{ scale: ringScale.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.2] }) }],
    opacity: ringOpacity,
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.center}>
        <View style={styles.badgeWrap}>
          <Animated.View style={[styles.ring, ring]} />
          <Animated.View style={[styles.badge, { transform: [{ scale: badgeScale }] }]}>
            <Ionicons name="checkmark-sharp" size={56} color={Colors.white} />
          </Animated.View>
        </View>

        <Animated.View style={{ opacity: textOpacity, transform: [{ translateY: textShift }], alignItems: 'center' }}>
          <Text style={styles.title}>{t('checkout.orderPlacedTitle')}</Text>
          <Text style={styles.subtitle}>{t('checkout.orderPlacedSub')}</Text>

          {isGroup ? (
            // Per-shop breakdown: "₹195 — Shop A", "₹184 — Shop B", then the total.
            <View style={styles.breakdownCard}>
              <Text style={styles.breakdownHeading}>
                {t('checkout.ordersPlacedCount').replace('{n}', String(shops!.length))}
              </Text>
              {shops!.map((s) => (
                <View key={s.orderId} style={styles.breakdownRow}>
                  <Text style={styles.breakdownShop} numberOfLines={1}>{s.shopName}</Text>
                  <Text style={styles.breakdownAmt}>₹{Math.round(s.total / 100)}</Text>
                </View>
              ))}
              <View style={styles.breakdownDivider} />
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownTotalLabel}>{t('checkout.grandTotal')}</Text>
                <Text style={styles.breakdownTotalAmt}>₹{Math.round((totalAmount ?? 0) / 100)}</Text>
              </View>
            </View>
          ) : (
            <View style={styles.orderIdPill}>
              <Ionicons name="receipt-outline" size={14} color={Colors.textSecondary} />
              <Text style={styles.orderIdText}>#{orderId.slice(-6).toUpperCase()}</Text>
            </View>
          )}
        </Animated.View>
      </View>

      <Animated.View style={{ opacity: textOpacity, paddingHorizontal: Spacing.lg }}>
        <TouchableOpacity style={styles.trackBtn} activeOpacity={0.9} onPress={goToTracking}>
          <Text style={styles.trackBtnText}>{t('checkout.trackOrder')}</Text>
          <Ionicons name="arrow-forward" size={18} color={Colors.white} />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background, justifyContent: 'space-between' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.xl },

    badgeWrap: { width: 160, height: 160, alignItems: 'center', justifyContent: 'center' },
    ring: {
      position: 'absolute', width: 120, height: 120, borderRadius: 60,
      backgroundColor: Colors.success,
    },
    badge: {
      width: 108, height: 108, borderRadius: 54,
      backgroundColor: Colors.success,
      alignItems: 'center', justifyContent: 'center',
      ...Shadow.lg,
    },

    title: { fontSize: FontSize.xxxl, fontWeight: FontWeight.heavy, color: Colors.textPrimary, letterSpacing: -0.5 },
    subtitle: {
      fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center',
      marginTop: Spacing.xs, paddingHorizontal: Spacing.xxl, lineHeight: 22,
    },
    orderIdPill: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: Colors.surfaceAlt, borderRadius: Radius.full,
      paddingHorizontal: Spacing.md, paddingVertical: 6, marginTop: Spacing.lg,
    },
    orderIdText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.textSecondary, letterSpacing: 0.5 },

    // Multi-shop per-shop breakdown card.
    breakdownCard: {
      alignSelf: 'stretch', marginTop: Spacing.lg, marginHorizontal: Spacing.xl,
      backgroundColor: Colors.surfaceAlt, borderRadius: Radius.lg,
      padding: Spacing.lg, gap: Spacing.sm,
    },
    breakdownHeading: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.textSecondary, marginBottom: Spacing.xs },
    breakdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
    breakdownShop: { flex: 1, fontSize: FontSize.md, color: Colors.textPrimary, fontWeight: FontWeight.semibold },
    breakdownAmt: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.textPrimary },
    breakdownDivider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.xs },
    breakdownTotalLabel: { fontSize: FontSize.md, fontWeight: FontWeight.heavy, color: Colors.textPrimary },
    breakdownTotalAmt: { fontSize: FontSize.lg, fontWeight: FontWeight.heavy, color: Colors.primary },

    trackBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: Colors.primary, borderRadius: Radius.xl,
      height: 56, marginBottom: Spacing.md, ...Shadow.primary,
    },
    trackBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: FontWeight.black },
  });
