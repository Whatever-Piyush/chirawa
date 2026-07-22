import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, TouchableOpacity, View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { FoodOrderDetail, FoodOrderStatus } from '@chirawa/types';
import { useT } from '@chirawa/i18n';
import { Text, useToast } from '../../components/ui';
import { type RazorpaySuccess } from '../../components/payment/RazorpayCheckout';
import { Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { api } from '../../services/api.service';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { FOOD_ACCENT, FOOD_ACCENT_SOFT } from './foodTheme';

const RazorpayCheckout = React.lazy(() => import('../../components/payment/RazorpayCheckout'));

// ─── Food order tracking (Food.md §8.5) ───────────────────────────────────────
// Own screen over the food pipeline (the marketplace OrderTracking reads the
// marketplace order table and is untouched). Simple, premium status timeline +
// 10s polling; "Pay now" re-opens the UPI sheet for a pending_payment order.

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'FoodOrderTracking'>;
  route:      RouteProp<RootStackParamList, 'FoodOrderTracking'>;
};

const STEPS: Array<{ status: FoodOrderStatus; icon: string; key: string }> = [
  { status: 'paid',             icon: 'checkmark-circle-outline', key: 'food.statusPaid' },
  { status: 'confirmed',        icon: 'storefront-outline',       key: 'food.statusConfirmed' },
  { status: 'preparing',        icon: 'flame-outline',            key: 'food.statusPreparing' },
  { status: 'ready_for_pickup', icon: 'bag-check-outline',        key: 'food.statusReady' },
  { status: 'picked_up',        icon: 'bicycle-outline',          key: 'food.statusPickedUp' },
  { status: 'out_for_delivery', icon: 'navigate-outline',         key: 'food.statusOutForDelivery' },
  { status: 'delivered',        icon: 'happy-outline',            key: 'food.statusDelivered' },
];

const STEP_INDEX: Record<string, number> = Object.fromEntries(STEPS.map((s, i) => [s.status, i]));

const STEP_TIME_FIELD: Record<string, keyof FoodOrderDetail> = {
  paid: 'paidAt', confirmed: 'confirmedAt', preparing: 'preparingAt',
  ready_for_pickup: 'readyAt', picked_up: 'pickedUpAt',
  out_for_delivery: 'outForDeliveryAt', delivered: 'deliveredAt',
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export default function FoodOrderTrackingScreen({ navigation, route }: Props) {
  const { foodOrderId, payment } = route.params;
  const t = useT();
  const toast = useToast();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  const [order, setOrder]     = useState<FoodOrderDetail | null>(null);
  const [paySheet, setPaySheet] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      setOrder(await api.getFoodOrder(foodOrderId));
    } catch {
      /* keep last state — transient network noise must not blank tracking */
    }
  }, [foodOrderId]);

  // Poll every 10s while the order is live; stop on terminal states.
  useEffect(() => {
    void load();
    pollRef.current = setInterval(() => void load(), 10_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);
  useEffect(() => {
    if (order && ['delivered', 'cancelled'].includes(order.status) && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [order]);

  const cancelOrder = useCallback(() => {
    Alert.alert(t('food.cancelOrder'), t('food.cancelConfirm'), [
      { text: t('common.no') ?? 'No', style: 'cancel' },
      {
        text: t('common.yes') ?? 'Yes', style: 'destructive',
        onPress: () => {
          void api.cancelFoodOrder(foodOrderId)
            .then((r) => { toast.show(r.message, 'success'); void load(); })
            .catch((e: unknown) => toast.show(e instanceof Error ? e.message : t('common.error'), 'error'));
        },
      },
    ]);
  }, [foodOrderId, load, t, toast]);

  const handlePaymentSuccess = useCallback(async (r: RazorpaySuccess) => {
    setPaySheet(false);
    try {
      await api.verifyFoodPayment(foodOrderId, {
        razorpayOrderId:   r.razorpayOrderId,
        razorpayPaymentId: r.razorpayPaymentId,
        razorpaySignature: r.razorpaySignature,
      });
      toast.show(t('food.statusPaid'), 'success');
    } catch (e: unknown) {
      toast.show(e instanceof Error ? e.message : t('checkout.paymentFailed'), 'error');
    }
    void load();
  }, [foodOrderId, load, t, toast]);

  if (!order) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={FOOD_ACCENT} size="large" />
      </View>
    );
  }

  const cancelled       = order.status === 'cancelled';
  const pendingPayment  = order.status === 'pending_payment';
  const reachedIdx      = STEP_INDEX[order.status] ?? -1;
  const cancellable     = ['pending_payment', 'paid'].includes(order.status);

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      {/* ── Restaurant + ETA hero ─────────────────────────────────────────── */}
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Ionicons name="restaurant" size={22} color={FOOD_ACCENT} />
        </View>
        <Text weight="bold" color={Colors.textPrimary} style={styles.heroName} numberOfLines={1}>
          {order.restaurant.name}
        </Text>
        {!cancelled && !pendingPayment && order.status !== 'delivered' && (
          <View style={styles.etaBand}>
            <Ionicons name="time-outline" size={13} color={FOOD_ACCENT} />
            <Text weight="semibold" color={FOOD_ACCENT} style={styles.etaText}>
              {order.eta.minMinutes}–{order.eta.maxMinutes} min
            </Text>
          </View>
        )}
      </View>

      {/* ── Pending payment banner + Pay now ─────────────────────────────── */}
      {pendingPayment && (
        <View style={styles.pendingCard}>
          <Ionicons name="alert-circle-outline" size={20} color={Colors.warning} />
          <Text weight="regular" color={Colors.textPrimary} style={styles.pendingText}>
            {t('food.paymentPending')}
          </Text>
          {payment && (
            <TouchableOpacity style={styles.payNowBtn} activeOpacity={0.85} onPress={() => setPaySheet(true)}>
              <Text weight="bold" color={Colors.white} style={styles.payNowText}>{t('food.payNow')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── Cancelled state ───────────────────────────────────────────────── */}
      {cancelled ? (
        <View style={styles.cancelledCard}>
          <Ionicons name="close-circle-outline" size={26} color={Colors.error} />
          <Text weight="bold" color={Colors.textPrimary} style={styles.cancelledTitle}>
            {t('food.statusCancelled')}
          </Text>
          {order.refundedPaise > 0 && (
            <Text weight="regular" color={Colors.textSecondary} align="center" style={styles.refundNote}>
              {t('food.refundNote')}
            </Text>
          )}
        </View>
      ) : (
        /* ── Status timeline ─────────────────────────────────────────────── */
        <View style={styles.timeline}>
          {STEPS.map((step, i) => {
            const done   = reachedIdx >= i;
            const isLast = i === STEPS.length - 1;
            const at     = order[STEP_TIME_FIELD[step.status]!] as string | null;
            return (
              <View key={step.status} style={styles.stepRow}>
                <View style={styles.stepRail}>
                  <View style={[styles.stepDot, done && styles.stepDotDone]}>
                    <Ionicons
                      name={step.icon as never}
                      size={14}
                      color={done ? Colors.white : Colors.textTertiary}
                    />
                  </View>
                  {!isLast && <View style={[styles.stepLine, reachedIdx > i && styles.stepLineDone]} />}
                </View>
                <View style={styles.stepBody}>
                  <Text
                    weight={done ? 'semibold' : 'regular'}
                    color={done ? Colors.textPrimary : Colors.textTertiary}
                    style={styles.stepLabel}
                  >
                    {t(step.key)}
                  </Text>
                  {done && at ? (
                    <Text weight="regular" color={Colors.textTertiary} style={styles.stepTime}>
                      {fmtTime(at)}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* ── Items + bill recap ────────────────────────────────────────────── */}
      <View style={styles.section}>
        {order.items.map((it) => (
          <View key={it.id} style={styles.itemRow}>
            <Text weight="regular" color={Colors.textSecondary} style={styles.itemQty}>
              {it.quantity}×
            </Text>
            <Text weight="regular" color={Colors.textPrimary} numberOfLines={1} style={styles.itemName}>
              {it.name}
            </Text>
            <Text weight="semibold" color={Colors.textPrimary} style={styles.itemAmt}>
              ₹{Math.round(it.subtotal / 100)}
            </Text>
          </View>
        ))}
        <View style={styles.billDivider} />
        <View style={styles.itemRow}>
          <Text weight="regular" color={Colors.textSecondary} style={[styles.itemName, { marginLeft: 0 }]}>
            {t('food.deliveryFee')}
          </Text>
          <Text weight="semibold" color={Colors.textPrimary} style={styles.itemAmt}>
            ₹{Math.round(order.deliveryFeePaise / 100)}
          </Text>
        </View>
        <View style={styles.itemRow}>
          <Text weight="bold" color={Colors.textPrimary} style={[styles.itemName, { marginLeft: 0 }]}>
            {t('checkout.grandTotal')}
          </Text>
          <Text weight="bold" color={Colors.textPrimary} style={styles.itemAmt}>
            ₹{Math.round(order.totalPaise / 100)}
          </Text>
        </View>
      </View>

      {/* ── Cancel (before the kitchen starts) ────────────────────────────── */}
      {cancellable && (
        <TouchableOpacity style={styles.cancelBtn} activeOpacity={0.8} onPress={cancelOrder}>
          <Text weight="semibold" color={Colors.error}>{t('food.cancelOrder')}</Text>
        </TouchableOpacity>
      )}

      {/* ── Re-openable UPI sheet for pending payments ────────────────────── */}
      {paySheet && payment && (
        <Suspense fallback={null}>
          <RazorpayCheckout
            visible
            keyId={payment.razorpayKeyId}
            razorpayOrderId={payment.razorpayOrderId}
            amountPaise={payment.amountPaise}
            merchantName="Bringly Food"
            description={`Food order — ${order.restaurant.name}`}
            themeColor={FOOD_ACCENT}
            onSuccess={(r) => void handlePaymentSuccess(r)}
            onDismiss={() => setPaySheet(false)}
            onError={(msg) => { toast.show(msg, 'error'); setPaySheet(false); }}
          />
        </Suspense>
      )}
    </ScrollView>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: Colors.background },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
    content: { padding: Spacing.md, paddingBottom: Spacing.huge },

    hero: {
      alignItems: 'center', gap: 6,
      backgroundColor: Colors.surface, borderRadius: Radius.xl,
      padding: Spacing.lg, marginBottom: Spacing.md,
      ...Shadow.xs,
    },
    heroIcon: {
      width: 48, height: 48, borderRadius: 20,
      backgroundColor: FOOD_ACCENT_SOFT,
      alignItems: 'center', justifyContent: 'center',
    },
    heroName: { fontSize: 16, lineHeight: 21 },
    etaBand: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 10, paddingVertical: 5,
      borderRadius: Radius.full, backgroundColor: FOOD_ACCENT_SOFT,
    },
    etaText: { fontSize: 11, lineHeight: 14 },

    pendingCard: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
      backgroundColor: Colors.warningLight, borderRadius: Radius.lg,
      padding: Spacing.md, marginBottom: Spacing.md,
    },
    pendingText: { flex: 1, fontSize: 12, lineHeight: 16 },
    payNowBtn: {
      paddingHorizontal: 14, paddingVertical: 8,
      borderRadius: Radius.md, backgroundColor: FOOD_ACCENT,
    },
    payNowText: { fontSize: 12, lineHeight: 15 },

    cancelledCard: {
      alignItems: 'center', gap: 6,
      backgroundColor: Colors.surface, borderRadius: Radius.xl,
      padding: Spacing.xl, marginBottom: Spacing.md,
      ...Shadow.xs,
    },
    cancelledTitle: { fontSize: 15, lineHeight: 20 },
    refundNote: { fontSize: 12, lineHeight: 17, maxWidth: 260 },

    timeline: {
      backgroundColor: Colors.surface, borderRadius: Radius.xl,
      padding: Spacing.lg, marginBottom: Spacing.md,
      ...Shadow.xs,
    },
    stepRow: { flexDirection: 'row', gap: Spacing.md },
    stepRail: { alignItems: 'center', width: 28 },
    stepDot: {
      width: 28, height: 28, borderRadius: 14,
      backgroundColor: Colors.surfaceAlt,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: Colors.border,
    },
    stepDotDone: { backgroundColor: FOOD_ACCENT, borderColor: FOOD_ACCENT },
    stepLine: { width: 2, flex: 1, minHeight: 18, backgroundColor: Colors.border, marginVertical: 2 },
    stepLineDone: { backgroundColor: FOOD_ACCENT },
    stepBody: { flex: 1, paddingBottom: Spacing.md },
    stepLabel: { fontSize: 13, lineHeight: 18 },
    stepTime: { fontSize: 10, lineHeight: 14, marginTop: 1 },

    section: {
      backgroundColor: Colors.surface, borderRadius: Radius.xl,
      padding: Spacing.md, marginBottom: Spacing.md,
      ...Shadow.xs,
    },
    itemRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 5,
    },
    itemQty: { width: 28, fontSize: 12 },
    itemName: { flex: 1, fontSize: 13, lineHeight: 17, marginLeft: 2 },
    itemAmt: { fontSize: 13, minWidth: 50, textAlign: 'right' },
    billDivider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.sm },

    cancelBtn: {
      alignItems: 'center', paddingVertical: Spacing.md,
      borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.errorLight,
      backgroundColor: Colors.surface,
    },
  });
