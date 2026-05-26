import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type {
  CartItem,
  CartResponse,
  PricingPreviewResponse,
} from '@chirawa/types';
import { PaymentMethod } from '@chirawa/types';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Colors, FontSize, MIN_TAP, Radius, Spacing } from '../../theme';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Checkout'> };

// Chirawa town centre — used for all addresses since the town is small and no map picker is needed
const CHIRAWA_LAT     = 28.2330;
const CHIRAWA_LNG     = 75.6307;
const CHIRAWA_PINCODE = '333026';

// ─── Order summary item row ───────────────────────────────────────────────────

function SummaryItem({ item }: { item: CartItem }) {
  return (
    <View style={styles.summaryItem}>
      <View style={styles.summaryItemLeft}>
        <Text style={styles.summaryItemName} numberOfLines={2}>{item.productName}</Text>
        <Text style={styles.summaryItemQty}>×{item.quantity}</Text>
      </View>
      <Text style={styles.summaryItemPrice}>₹{Math.round(item.subtotal / 100)}</Text>
    </View>
  );
}

// ─── Payment method card ──────────────────────────────────────────────────────

interface PayCardProps {
  icon: string;
  title: string;
  hint: string;
  selected: boolean;
  badge?: string;
  onPress: () => void;
}

function PayCard({ icon, title, hint, selected, badge, onPress }: PayCardProps) {
  return (
    <TouchableOpacity
      style={[styles.payCard, selected && styles.payCardSelected]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.payCardLeft}>
        <Text style={styles.payCardIcon}>{icon}</Text>
        <View style={styles.payCardText}>
          <Text style={[styles.payCardTitle, selected && styles.payCardTitleSelected]}>{title}</Text>
          <Text style={styles.payCardHint}>{hint}</Text>
        </View>
      </View>
      <View style={styles.payCardRight}>
        {badge ? (
          <View style={styles.comingSoonBadge}>
            <Text style={styles.comingSoonBadgeText}>{badge}</Text>
          </View>
        ) : (
          <View style={[styles.radio, selected && styles.radioSelected]}>
            {selected && <View style={styles.radioDot} />}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function CheckoutScreen({ navigation }: Props) {
  const t = useT();

  // ── Cart ──────────────────────────────────────────────────────────────────
  const [cart, setCart]           = useState<CartResponse | null>(null);
  const [cartLoading, setCartLoading] = useState(true);

  // ── Address form ──────────────────────────────────────────────────────────
  const [street, setStreet]     = useState('');
  const [area,   setArea]       = useState('');

  // ── Address confirmation state ────────────────────────────────────────────
  const [addressId,  setAddressId]  = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // ── Pricing ───────────────────────────────────────────────────────────────
  const [pricing, setPricing] = useState<PricingPreviewResponse | null>(null);

  // ── Payment ───────────────────────────────────────────────────────────────
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.COD);
  const [placing,       setPlacing]       = useState(false);

  // ─── Header ───────────────────────────────────────────────────────────────

  useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: t('checkout.title') });
  }, [navigation, t]);

  // ─── Load cart ────────────────────────────────────────────────────────────

  const loadCart = useCallback(async () => {
    try {
      const data = await api.getCart();
      if (!data || data.items.length === 0) {
        Alert.alert(t('cart.empty'), t('cart.emptyHint'), [
          { text: t('common.back'), onPress: () => navigation.goBack() },
        ]);
        return;
      }
      setCart(data);
    } catch {
      Alert.alert(t('common.error'), t('common.retry'), [
        { text: t('common.back'), onPress: () => navigation.goBack() },
      ]);
    } finally {
      setCartLoading(false);
    }
  }, [navigation, t]);

  useEffect(() => { void loadCart(); }, [loadCart]);

  // ─── Reset confirmation when address inputs change ────────────────────────

  useEffect(() => {
    setAddressId(null);
    setPricing(null);
  }, [street, area]);

  // ─── Confirm address → create in backend → fetch pricing ─────────────────

  const handleConfirmAddress = useCallback(async () => {
    if (!street.trim() || !area.trim() || !cart) return;
    setConfirming(true);
    try {
      const addr = await api.createAddress({
        street:   street.trim(),
        landmark: area.trim(),
        locality: area.trim(),
        city:     'Chirawa',
        pincode:  CHIRAWA_PINCODE,
        lat:      CHIRAWA_LAT,
        lng:      CHIRAWA_LNG,
      });
      setAddressId(addr.id);
      const preview = await api.getPricingPreview({ cartId: cart.cartId, addressId: addr.id });
      setPricing(preview);
    } catch {
      Alert.alert(t('common.error'), t('common.retry'));
    } finally {
      setConfirming(false);
    }
  }, [street, area, cart, t]);

  // ─── Place order ──────────────────────────────────────────────────────────

  const handlePlaceOrder = useCallback(async () => {
    if (!cart || !street.trim()) return;

    if (paymentMethod !== PaymentMethod.COD) {
      Alert.alert('🚀', t('checkout.comingSoon'));
      return;
    }

    setPlacing(true);
    try {
      // Create address on demand if the user skipped the "Confirm" step
      let addrId = addressId;
      if (!addrId) {
        const addr = await api.createAddress({
          street:   street.trim(),
          landmark: area.trim() || street.trim(),
          locality: area.trim() || 'Chirawa',
          city:     'Chirawa',
          pincode:  CHIRAWA_PINCODE,
          lat:      CHIRAWA_LAT,
          lng:      CHIRAWA_LNG,
        });
        addrId = addr.id;
      }

      const result = await api.placeOrder({
        cartId:        cart.cartId,
        addressId:     addrId,
        paymentMethod: PaymentMethod.COD,
      });

      navigation.replace('OrderTracking', { orderId: result.orderId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.error');
      Alert.alert(t('common.error'), msg);
    } finally {
      setPlacing(false);
    }
  }, [cart, street, area, addressId, paymentMethod, navigation, t]);

  // ─── Derived pricing ──────────────────────────────────────────────────────

  const subtotalRupees  = cart ? Math.round(cart.subtotal / 100) : 0;
  const deliveryRupees  = pricing ? Math.round(pricing.deliveryFee / 100) : null;
  const totalRupees     = pricing ? Math.round(pricing.total / 100) : subtotalRupees;

  const canPlaceOrder   = !!street.trim() && !!area.trim() && !placing && !!cart;
  const canConfirm      = !!street.trim() && !!area.trim() && !confirming;

  // ─── Header component for FlatList ────────────────────────────────────────

  const ListHeader = (
    <>
      {/* ── A. Delivery Address ──────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('checkout.deliveryAddress')}</Text>

        <View style={styles.cityChipRow}>
          <Text style={styles.cityChip}>📍 {t('checkout.chirawa')}</Text>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t('checkout.streetLabel')}</Text>
          <TextInput
            style={styles.textInput}
            value={street}
            onChangeText={setStreet}
            placeholder={t('checkout.streetPlaceholder')}
            placeholderTextColor={Colors.textMuted}
            returnKeyType="next"
            autoCapitalize="words"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t('checkout.areaLabel')}</Text>
          <TextInput
            style={styles.textInput}
            value={area}
            onChangeText={setArea}
            placeholder={t('checkout.areaPlaceholder')}
            placeholderTextColor={Colors.textMuted}
            returnKeyType="done"
            autoCapitalize="words"
          />
        </View>

        <TouchableOpacity
          style={[
            styles.confirmAddressBtn,
            !canConfirm && styles.btnDisabled,
            addressId && styles.btnConfirmed,
          ]}
          onPress={() => void handleConfirmAddress()}
          disabled={!canConfirm}
          activeOpacity={0.8}
        >
          {confirming ? (
            <ActivityIndicator color={Colors.white} size="small" />
          ) : (
            <Text style={styles.confirmAddressBtnText}>
              {addressId
                ? `✓  ${t('checkout.addressConfirmed')}`
                : t('checkout.confirmAddress')}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* ── B. Order Summary header ──────────────────────────────────────── */}
      <View style={[styles.section, styles.sectionNoBottomPad]}>
        <Text style={styles.sectionTitle}>{t('checkout.orderSummary')}</Text>
        {cart && <Text style={styles.shopNameRow}>🏪 {cart.shopName}</Text>}
      </View>
    </>
  );

  // ─── Footer component for FlatList ────────────────────────────────────────

  const ListFooter = (
    <>
      {/* Pricing breakdown */}
      <View style={[styles.section, styles.sectionNoTopPad]}>
        <View style={styles.divider} />

        <View style={styles.pricingRow}>
          <Text style={styles.pricingLabel}>{t('cart.subtotal')}</Text>
          <Text style={styles.pricingValue}>₹{subtotalRupees}</Text>
        </View>

        <View style={styles.pricingRow}>
          <Text style={styles.pricingLabel}>{t('cart.deliveryFee')}</Text>
          {deliveryRupees === null ? (
            <Text style={styles.pricingMuted}>{t('checkout.confirmToSee')}</Text>
          ) : (
            <Text style={styles.pricingValue}>₹{deliveryRupees}</Text>
          )}
        </View>

        <View style={[styles.pricingRow, styles.totalRow]}>
          <Text style={styles.totalLabel}>{t('cart.total')}</Text>
          <Text style={styles.totalValue}>₹{totalRupees}</Text>
        </View>

        {pricing?.breakdownText ? (
          <Text style={styles.breakdownText}>{pricing.breakdownText}</Text>
        ) : null}
      </View>

      {/* ── C. Payment Method ────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('checkout.paymentMethod')}</Text>

        <PayCard
          icon="💵"
          title={t('checkout.cod')}
          hint={t('checkout.codHint')}
          selected={paymentMethod === PaymentMethod.COD}
          onPress={() => setPaymentMethod(PaymentMethod.COD)}
        />

        <PayCard
          icon="📱"
          title={t('checkout.payOnline')}
          hint={t('checkout.onlineHint')}
          selected={false}
          badge="Soon"
          onPress={() => Alert.alert('🚀', t('checkout.comingSoon'))}
        />
      </View>

      {/* Bottom spacer so content is not hidden behind sticky button */}
      <View style={styles.bottomSpacer} />
    </>
  );

  // ─── Loading ──────────────────────────────────────────────────────────────

  if (cartLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>{t('common.loading')}</Text>
      </View>
    );
  }

  if (!cart) return null;

  // ─── Main render ──────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={88}
    >
      <FlatList
        data={cart.items}
        keyExtractor={(item) => item.productId}
        renderItem={({ item }) => <SummaryItem item={item} />}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        ItemSeparatorComponent={() => <View style={styles.itemSeparator} />}
        style={styles.flex}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      />

      {/* ── D. Sticky Place Order ─────────────────────────────────────────── */}
      <View style={styles.stickyBottom}>
        <View style={styles.orderTotalBar}>
          <Text style={styles.orderTotalLabel}>{t('cart.total')}</Text>
          <Text style={styles.orderTotalValue}>₹{totalRupees}</Text>
        </View>
        <TouchableOpacity
          style={[styles.placeOrderBtn, !canPlaceOrder && styles.btnDisabled]}
          onPress={() => void handlePlaceOrder()}
          disabled={!canPlaceOrder}
          activeOpacity={0.9}
        >
          {placing ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={styles.placeOrderBtnText}>{t('checkout.placeOrder')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },

  // Loading
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background, gap: Spacing.md },
  loadingText:      { fontSize: FontSize.md, color: Colors.textLight },

  // List
  listContent: { paddingBottom: 0 },

  // Section card
  section: {
    backgroundColor: Colors.card, marginHorizontal: Spacing.lg,
    marginTop: Spacing.md, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.md,
  },
  sectionNoBottomPad: { paddingBottom: 0 },
  sectionNoTopPad:    { borderTopLeftRadius: 0, borderTopRightRadius: 0, paddingTop: 0, marginTop: 0 },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },

  // City chip
  cityChipRow: { flexDirection: 'row' },
  cityChip: {
    fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600',
    backgroundColor: '#FFF0F3', paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs, borderRadius: Radius.full,
    alignSelf: 'flex-start',
  },

  // Address form
  fieldGroup: { gap: Spacing.xs },
  fieldLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textLight },
  textInput: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    fontSize: FontSize.md, color: Colors.text, backgroundColor: Colors.background,
    minHeight: MIN_TAP,
  },

  // Confirm address button
  confirmAddressBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: Spacing.md, alignItems: 'center',
    minHeight: MIN_TAP, justifyContent: 'center',
  },
  btnDisabled:  { backgroundColor: Colors.disabled },
  btnConfirmed: { backgroundColor: Colors.success },
  confirmAddressBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },

  // Order summary
  shopNameRow:   { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  summaryItem: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm, backgroundColor: Colors.background,
    minHeight: MIN_TAP,
  },
  summaryItemLeft:  { flex: 1, gap: 2 },
  summaryItemName:  { fontSize: FontSize.md, color: Colors.text, fontWeight: '500', paddingRight: Spacing.md },
  summaryItemQty:   { fontSize: FontSize.sm, color: Colors.textMuted },
  summaryItemPrice: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primary },
  itemSeparator:    { height: 1, backgroundColor: Colors.border },

  // Pricing
  divider:      { height: 1, backgroundColor: Colors.border, marginBottom: Spacing.xs },
  pricingRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pricingLabel: { fontSize: FontSize.md, color: Colors.textLight },
  pricingValue: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  pricingMuted: { fontSize: FontSize.sm, color: Colors.textMuted, fontStyle: 'italic' },
  totalRow:     { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm, marginTop: Spacing.xs },
  totalLabel:   { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  totalValue:   { fontSize: FontSize.lg, fontWeight: '800', color: Colors.primary },
  breakdownText:{ fontSize: FontSize.sm, color: Colors.textMuted, fontStyle: 'italic', marginTop: Spacing.xs },

  // Payment method cards
  payCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    padding: Spacing.md, minHeight: MIN_TAP + 16,
  },
  payCardSelected: { borderColor: Colors.primary, backgroundColor: '#FFF0F3' },
  payCardLeft:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  payCardRight: { marginLeft: Spacing.sm },
  payCardIcon:  { fontSize: 26 },
  payCardText:  { gap: 2 },
  payCardTitle: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  payCardTitleSelected: { color: Colors.primary },
  payCardHint:  { fontSize: FontSize.sm, color: Colors.textMuted },
  radio: {
    width: 22, height: 22, borderRadius: Radius.full,
    borderWidth: 2, borderColor: Colors.border,
    justifyContent: 'center', alignItems: 'center',
  },
  radioSelected: { borderColor: Colors.primary },
  radioDot: {
    width: 10, height: 10, borderRadius: Radius.full,
    backgroundColor: Colors.primary,
  },
  comingSoonBadge: {
    backgroundColor: Colors.warning, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: 2,
  },
  comingSoonBadgeText: { fontSize: FontSize.xs, color: Colors.white, fontWeight: '700' },

  // Bottom spacer
  bottomSpacer: { height: 140 },

  // Sticky bottom
  stickyBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.border,
    padding: Spacing.lg, gap: Spacing.sm,
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1, shadowRadius: 8, elevation: 8,
  },
  orderTotalBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingBottom: Spacing.sm,
  },
  orderTotalLabel: { fontSize: FontSize.md, color: Colors.textLight, fontWeight: '600' },
  orderTotalValue: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.primary },
  placeOrderBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.lg,
    paddingVertical: Spacing.md, alignItems: 'center',
    minHeight: MIN_TAP, justifyContent: 'center',
  },
  placeOrderBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '800' },
});
