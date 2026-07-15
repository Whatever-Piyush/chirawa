import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, StyleSheet, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { FoodCheckoutPreview, PlaceFoodOrderResponse } from '@chirawa/types';
import { useT } from '@chirawa/i18n';
import { Text, useToast } from '../../components/ui';
import { type RazorpaySuccess } from '../../components/payment/RazorpayCheckout';
import { Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { api } from '../../services/api.service';
import { useFoodCart } from '../../context/FoodCartContext';
import { useAddresses } from '../../context/AddressContext';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { FOOD_ACCENT, FOOD_ACCENT_SOFT } from './foodTheme';

// Lazy like the marketplace checkout — only online payment needs the webview.
const RazorpayCheckout = React.lazy(() => import('../../components/payment/RazorpayCheckout'));

// ─── Food checkout (Food.md §8.4) ─────────────────────────────────────────────
// Visually identical to the marketplace checkout's language — section cards,
// bill rows, payment options, sticky deliver-to + CTA — but driven ENTIRELY by
// the food cart + food pricing. Decided deltas ONLY: flat ₹30 delivery line,
// UPI preselected as the single live method, COD rendered as a disabled
// "Coming Soon" row. The marketplace CheckoutScreen is untouched.

type Navigation = NativeStackNavigationProp<RootStackParamList, 'FoodCheckout'>;

export default function FoodCheckoutScreen({ navigation }: { navigation: Navigation }) {
  const t = useT();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const { cart, count, setQuantity, refresh, pendingMutations, flushPendingMutations } = useFoodCart();
  const { current: selectedAddr } = useAddresses();

  const [preview, setPreview]   = useState<FoodCheckoutPreview | null>(null);
  const [placing, setPlacing]   = useState(false);
  const [rzp, setRzp]           = useState<PlaceFoodOrderResponse | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Bill preview — recomputed whenever the cart changes.
  useEffect(() => {
    if (count === 0) { setPreview(null); return; }
    let active = true;
    api.getFoodCheckoutPreview()
      .then((p) => { if (active) setPreview(p); })
      .catch(() => { if (active) setPreview(null); });
    return () => { active = false; };
  }, [count, cart?.itemsSubtotalPaise]);

  // Cart emptied (last stepper tap) → back to the Food tab.
  useEffect(() => {
    if (count === 0 && !rzp && !verifying) navigation.goBack();
  }, [count, rzp, verifying, navigation]);

  const subtotalRupees = Math.round((preview?.itemsSubtotalPaise ?? cart?.itemsSubtotalPaise ?? 0) / 100);
  const feeRupees      = preview ? Math.round(preview.deliveryFeePaise / 100) : null;
  const totalRupees    = preview ? Math.round(preview.totalPaise / 100) : subtotalRupees;
  const restaurantOpen = preview?.restaurant?.isCurrentlyOpen ?? true;

  const placeOrder = useCallback(async () => {
    if (!selectedAddr) {
      toast.show(t('address.selectAddress'), 'info');
      navigation.navigate('AddressList');
      return;
    }
    setPlacing(true);
    try {
      // Let any in-flight stepper write land first — placing consumes the
      // server cart, so a racing add would otherwise be stranded.
      await flushPendingMutations();
      const result = await api.placeFoodOrder({ addressId: selectedAddr.id });
      await refresh(); // cart was consumed server-side
      setRzp(result);  // → opens the UPI sheet
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('common.error');
      Alert.alert(t('common.error'), msg);
    } finally {
      setPlacing(false);
    }
  }, [selectedAddr, refresh, flushPendingMutations, navigation, t, toast]);

  // UPI sheet returned success → server-side verify, then tracking.
  const handlePaymentSuccess = useCallback(async (r: RazorpaySuccess) => {
    if (!rzp) return;
    setVerifying(true);
    try {
      await api.verifyFoodPayment(rzp.foodOrderId, {
        razorpayOrderId:   r.razorpayOrderId,
        razorpayPaymentId: r.razorpayPaymentId,
        razorpaySignature: r.razorpaySignature,
      });
      navigation.replace('FoodOrderTracking', { foodOrderId: rzp.foodOrderId });
    } catch (e: unknown) {
      Alert.alert(t('checkout.paymentFailed'), e instanceof Error ? e.message : t('checkout.paymentFailed'));
      navigation.replace('FoodOrderTracking', { foodOrderId: rzp.foodOrderId, payment: paymentParams(rzp) });
    } finally {
      setVerifying(false);
      setRzp(null);
    }
  }, [rzp, navigation, t]);

  // Sheet dismissed without paying — the order exists (pending_payment) and the
  // cart is consumed, so land on tracking where "Pay now" can reopen the sheet.
  const handlePaymentDismiss = useCallback(() => {
    if (!rzp) return;
    const order = rzp;
    setRzp(null);
    toast.show(t('food.paymentPending'), 'info');
    navigation.replace('FoodOrderTracking', { foodOrderId: order.foodOrderId, payment: paymentParams(order) });
  }, [rzp, navigation, t, toast]);

  if (!cart || count === 0) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={FOOD_ACCENT} size="large" />
      </View>
    );
  }

  const ListHeader = (
    <>
      {/* ── From <restaurant> + items card ────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.fromRow}>
          <View style={styles.fromIcon}>
            <Ionicons name="restaurant" size={16} color={FOOD_ACCENT} />
          </View>
          <Text weight="bold" color={Colors.textPrimary} numberOfLines={1} style={styles.fromName}>
            {cart.restaurantName ?? t('food.tabFood')}
          </Text>
          {preview && (
            <View style={styles.etaChip}>
              <Ionicons name="time-outline" size={11} color={FOOD_ACCENT} />
              <Text weight="semibold" color={FOOD_ACCENT} style={styles.etaChipText}>
                {preview.eta.minMinutes}–{preview.eta.maxMinutes} min
              </Text>
            </View>
          )}
        </View>
      </View>
    </>
  );

  const ListFooter = (
    <>
      {/* ── Bill details — identical structure to the marketplace bill card ── */}
      <View style={styles.section}>
        <Text weight="bold" color={Colors.textPrimary} style={styles.cardTitle}>
          {t('checkout.billDetails')}
        </Text>

        <View style={styles.billRow}>
          <View style={styles.billLabelWrap}>
            <Ionicons name="receipt-outline" size={16} color={Colors.textSecondary} />
            <Text weight="regular" color={Colors.textSecondary} style={styles.billLabel}>
              {t('checkout.itemsTotal')}
            </Text>
          </View>
          <Text weight="semibold" color={Colors.textPrimary}>₹{subtotalRupees}</Text>
        </View>

        <View style={styles.billRow}>
          <View style={styles.billLabelWrap}>
            <Ionicons name="bicycle-outline" size={17} color={Colors.textSecondary} />
            <Text weight="regular" color={Colors.textSecondary} style={styles.billLabel}>
              {t('food.deliveryFee')}
            </Text>
          </View>
          {feeRupees === null
            ? <ActivityIndicator size="small" color={FOOD_ACCENT} />
            : <Text weight="semibold" color={Colors.textPrimary}>₹{feeRupees}</Text>}
        </View>
        <Text weight="regular" color={Colors.textTertiary} style={styles.billBreakdown}>
          {t('food.deliveryFeeFlat')}
        </Text>

        <View style={styles.billDivider} />
        <View style={styles.billTotalRow}>
          <Text weight="bold" color={Colors.textPrimary} style={styles.billTotalLabel}>
            {t('checkout.grandTotal')}
          </Text>
          <Text weight="bold" color={Colors.textPrimary} style={styles.billTotalValue}>
            ₹{totalRupees}
          </Text>
        </View>
      </View>

      {/* ── Payment method — UPI live, COD "Coming Soon" (decided) ──────────── */}
      <View style={styles.section}>
        <Text weight="bold" color={Colors.textPrimary} style={styles.cardTitle}>
          {t('checkout.paymentMethod')}
        </Text>

        {/* UPI — the one live method, preselected and not de-selectable */}
        <View style={[styles.payOption, styles.payOptionSelected]}>
          <Ionicons name="flash-outline" size={22} color={FOOD_ACCENT} />
          <View style={{ flex: 1 }}>
            <Text weight="semibold" color={Colors.textPrimary} style={styles.payOptionTitle}>
              {t('food.payViaUpi')}
            </Text>
            <Text weight="regular" color={Colors.textSecondary} style={styles.payOptionHint}>
              {t('food.upiHint')}
            </Text>
          </View>
          <View style={[styles.payRadio, styles.payRadioSelected]}>
            <View style={styles.payRadioDot} />
          </View>
        </View>

        {/* COD — visible but faded + disabled, "Coming Soon" (Food.md §8.4) */}
        <TouchableOpacity
          style={[styles.payOption, styles.payOptionComingSoon]}
          activeOpacity={0.8}
          onPress={() => toast.show(t('food.codComingSoonHint'), 'info')}
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
        >
          <Ionicons name="cash-outline" size={22} color={Colors.textSecondary} />
          <View style={{ flex: 1 }}>
            <Text weight="semibold" color={Colors.textSecondary} style={styles.payOptionTitle}>
              {t('food.codComingSoon')}
            </Text>
            <Text weight="regular" color={Colors.textTertiary} style={styles.payOptionHint}>
              {t('food.codComingSoonHint')}
            </Text>
          </View>
          <View style={styles.comingSoonBadge}>
            <Text weight="semibold" color={Colors.textSecondary} style={styles.comingSoonBadgeText}>
              {t('common.comingSoon')}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      <View style={{ height: 150 + insets.bottom }} />
    </>
  );

  return (
    <View style={styles.flex}>
      <FlatList
        data={cart.items}
        keyExtractor={(item) => item.menuItemId}
        renderItem={({ item }) => (
          <View style={styles.itemRow}>
            <View style={{ flex: 1 }}>
              <Text weight="semibold" color={Colors.textPrimary} numberOfLines={2} style={styles.itemName}>
                {item.name}
              </Text>
              <Text weight="regular" color={Colors.textSecondary} style={styles.itemUnit}>
                ₹{Math.round(item.unitPricePaise / 100)}
              </Text>
            </View>
            <View style={styles.stepper}>
              <TouchableOpacity
                onPress={() => void setQuantity(item.menuItemId, item.quantity - 1)}
                style={styles.stepBtn} hitSlop={{ top: 8, bottom: 8, left: 6, right: 4 }}
              >
                <Ionicons name="remove" size={15} color={Colors.white} />
              </TouchableOpacity>
              <Text weight="bold" color={Colors.white} style={styles.stepCount}>{item.quantity}</Text>
              <TouchableOpacity
                onPress={() => void setQuantity(item.menuItemId, item.quantity + 1)}
                style={styles.stepBtn} hitSlop={{ top: 8, bottom: 8, left: 4, right: 6 }}
              >
                <Ionicons name="add" size={15} color={Colors.white} />
              </TouchableOpacity>
            </View>
            <Text weight="bold" color={Colors.textPrimary} style={styles.itemSubtotal}>
              ₹{Math.round(item.subtotalPaise / 100)}
            </Text>
          </View>
        )}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        style={styles.flex}
        contentContainerStyle={styles.listContent}
      />

      {/* ── Sticky bottom — deliver-to + full-width CTA (mirrors checkout) ──── */}
      <View style={[styles.stickyBottom, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
        <TouchableOpacity
          style={styles.deliverRow}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('AddressList')}
        >
          <View style={styles.deliverHomeCircle}>
            <Ionicons name="location" size={18} color={FOOD_ACCENT} />
          </View>
          <View style={{ flex: 1 }}>
            {selectedAddr ? (
              <>
                <Text weight="semibold" color={Colors.textPrimary} numberOfLines={1} style={styles.deliverLabel}>
                  {t('checkout.deliveringTo')}
                </Text>
                <Text weight="regular" color={Colors.textSecondary} numberOfLines={1} style={styles.deliverSub}>
                  {selectedAddr.street}, {selectedAddr.locality}
                </Text>
              </>
            ) : (
              <Text weight="semibold" color={Colors.textPrimary} numberOfLines={1} style={styles.deliverLabel}>
                {t('address.selectAddress')}
              </Text>
            )}
          </View>
          <View style={styles.changePill}>
            <Text weight="semibold" color={FOOD_ACCENT} style={styles.changePillText}>
              {t('checkout.change')}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.placeBtn, (placing || !preview || !restaurantOpen || pendingMutations > 0) && styles.placeBtnDisabled]}
          activeOpacity={0.9}
          disabled={placing || !preview || !restaurantOpen || pendingMutations > 0}
          onPress={() => void placeOrder()}
          accessibilityRole="button"
          accessibilityLabel={t('food.placeOrder')}
        >
          {placing ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <>
              <Text weight="bold" color={Colors.white} style={styles.placeBtnText}>
                {restaurantOpen ? t('food.placeOrder') : t('food.closed')}
              </Text>
              {restaurantOpen && (
                <Text weight="bold" color={Colors.white} style={styles.placeBtnText}>₹{totalRupees}</Text>
              )}
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Razorpay UPI sheet (shared component — already UPI-only) ────────── */}
      {rzp && (
        <Suspense fallback={null}>
          <RazorpayCheckout
            visible
            keyId={rzp.razorpayKeyId}
            razorpayOrderId={rzp.razorpayOrderId}
            amountPaise={rzp.amountPaise}
            merchantName="Bringly Food"
            description={`Food order — ${rzp.restaurantName}`}
            themeColor={FOOD_ACCENT}
            onSuccess={(r) => void handlePaymentSuccess(r)}
            onDismiss={handlePaymentDismiss}
            onError={(msg) => { toast.show(msg, 'error'); handlePaymentDismiss(); }}
          />
        </Suspense>
      )}
    </View>
  );
}

function paymentParams(o: PlaceFoodOrderResponse) {
  return { razorpayOrderId: o.razorpayOrderId, razorpayKeyId: o.razorpayKeyId, amountPaise: o.amountPaise };
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: Colors.background },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
    listContent: { padding: Spacing.md, gap: Spacing.md },

    section: {
      backgroundColor: Colors.surface,
      borderRadius: Radius.xl,
      padding: Spacing.md,
      marginBottom: Spacing.md,
      ...Shadow.xs,
    },
    cardTitle: { fontSize: 14, lineHeight: 19, marginBottom: Spacing.sm },

    fromRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    fromIcon: {
      width: 34, height: 34, borderRadius: 14,
      backgroundColor: FOOD_ACCENT_SOFT,
      alignItems: 'center', justifyContent: 'center',
    },
    fromName: { flex: 1, fontSize: 15, lineHeight: 20 },
    etaChip: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 8, paddingVertical: 4,
      borderRadius: Radius.full, backgroundColor: FOOD_ACCENT_SOFT,
    },
    etaChipText: { fontSize: 10, lineHeight: 13 },

    itemRow: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
      backgroundColor: Colors.surface,
      borderRadius: Radius.lg, padding: Spacing.md,
      marginBottom: Spacing.xs,
      ...Shadow.xs,
    },
    itemName: { fontSize: 13, lineHeight: 17 },
    itemUnit: { fontSize: 11, lineHeight: 15, marginTop: 2 },
    itemSubtotal: { fontSize: 13, minWidth: 46, textAlign: 'right' },
    stepper: {
      flexDirection: 'row', alignItems: 'center',
      height: 30, borderRadius: Radius.md,
      backgroundColor: FOOD_ACCENT, paddingHorizontal: 4,
    },
    stepBtn: { paddingHorizontal: 6, height: '100%', justifyContent: 'center' },
    stepCount: { fontSize: 13, minWidth: 18, textAlign: 'center' },

    billRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      marginTop: Spacing.sm,
    },
    billLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    billLabel: { fontSize: 13, lineHeight: 17 },
    billBreakdown: { fontSize: 11, lineHeight: 15, marginTop: 3, marginLeft: 23 },
    billDivider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.md },
    billTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    billTotalLabel: { fontSize: 15, lineHeight: 20 },
    billTotalValue: { fontSize: 17, lineHeight: 22 },

    payOption: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
      borderWidth: 1.5, borderColor: Colors.border,
      borderRadius: Radius.lg, padding: Spacing.md,
      marginTop: Spacing.sm,
    },
    payOptionSelected: { borderColor: FOOD_ACCENT, backgroundColor: FOOD_ACCENT_SOFT },
    payOptionComingSoon: { opacity: 0.55 },
    payOptionTitle: { fontSize: 13, lineHeight: 17 },
    payOptionHint: { fontSize: 11, lineHeight: 15 },
    payRadio: {
      width: 20, height: 20, borderRadius: 10,
      borderWidth: 2, borderColor: Colors.border,
      alignItems: 'center', justifyContent: 'center',
    },
    payRadioSelected: { borderColor: FOOD_ACCENT },
    payRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: FOOD_ACCENT },
    comingSoonBadge: {
      paddingHorizontal: 8, paddingVertical: 4,
      borderRadius: Radius.full, backgroundColor: Colors.surfaceAlt,
      borderWidth: 1, borderColor: Colors.border,
    },
    comingSoonBadgeText: { fontSize: 9, lineHeight: 12, letterSpacing: 0.3 },

    stickyBottom: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      backgroundColor: Colors.surface,
      borderTopLeftRadius: 20, borderTopRightRadius: 20,
      paddingHorizontal: Spacing.md, paddingTop: Spacing.sm,
      ...Shadow.md,
    },
    deliverRow: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
      paddingVertical: Spacing.xs,
    },
    deliverHomeCircle: {
      width: 34, height: 34, borderRadius: 17,
      backgroundColor: FOOD_ACCENT_SOFT,
      alignItems: 'center', justifyContent: 'center',
    },
    deliverLabel: { fontSize: 12, lineHeight: 16 },
    deliverSub: { fontSize: 11, lineHeight: 15 },
    changePill: {
      paddingHorizontal: 10, paddingVertical: 5,
      borderRadius: Radius.full, backgroundColor: FOOD_ACCENT_SOFT,
    },
    changePillText: { fontSize: 11, lineHeight: 14 },
    placeBtn: {
      height: 50, borderRadius: Radius.lg,
      backgroundColor: FOOD_ACCENT,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: Spacing.lg,
      marginTop: Spacing.xs,
    },
    placeBtnDisabled: { opacity: 0.6 },
    placeBtnText: { fontSize: 14, lineHeight: 18 },
  });
