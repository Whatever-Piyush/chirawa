import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  Keyboard,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type {
  AddressResponse,
  CartItem,
  CartResponse,
  PricingPreviewResponse,
} from '@chirawa/types';
import { PaymentMethod } from '@chirawa/types';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Colors, FontSize, FontWeight, MIN_TAP, Radius, Shadow, Spacing } from '../../theme';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';

type LabelChoice = 'home' | 'work' | 'other';
const LABEL_VALUE: Record<LabelChoice, string> = { home: 'घर', work: 'दुकान', other: 'अन्य' };
function labelEmoji(label?: string | null): string {
  if (label === 'घर')   return '🏠';
  if (label === 'दुकान') return '🏪';
  return '📍';
}

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Checkout'> };

const CHIRAWA_LAT     = 28.2330;
const CHIRAWA_LNG     = 75.6307;
const CHIRAWA_PINCODE = '333026';

// ─── Order summary item row ───────────────────────────────────────────────────

function SummaryItem({ item }: { item: CartItem }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.summaryItemName} numberOfLines={2}>{item.productName}</Text>
      <Text style={styles.summaryItemMeta}>×{item.quantity}  ₹{Math.round(item.subtotal / 100)}</Text>
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
  const checkScale = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(checkScale, {
      toValue:         selected ? 1 : 0,
      friction:        5,
      tension:         200,
      useNativeDriver: true,
    }).start();
  }, [selected, checkScale]);

  return (
    <TouchableOpacity
      style={[styles.payCard, selected && styles.payCardSelected]}
      onPress={onPress}
      activeOpacity={0.85}
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
        ) : selected ? (
          <Animated.Text style={[styles.payCheck, { transform: [{ scale: checkScale }] }]}>✓</Animated.Text>
        ) : (
          <View style={styles.radio} />
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Animated dots loading indicator ──────────────────────────────────────────

function LoadingDots() {
  const a = useRef(new Animated.Value(0.3)).current;
  const b = useRef(new Animated.Value(0.3)).current;
  const c = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const make = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1,   duration: 320, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0.3, duration: 320, useNativeDriver: true }),
        ]),
      );
    const anims = [make(a, 0), make(b, 160), make(c, 320)];
    anims.forEach((x) => x.start());
    return () => anims.forEach((x) => x.stop());
  }, [a, b, c]);

  return (
    <View style={styles.dotsRow}>
      <Animated.View style={[styles.dot, { opacity: a }]} />
      <Animated.View style={[styles.dot, { opacity: b }]} />
      <Animated.View style={[styles.dot, { opacity: c }]} />
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function CheckoutScreen({ navigation }: Props) {
  const t = useT();
  const insets = useSafeAreaInsets();

  const [cart, setCart]           = useState<CartResponse | null>(null);
  const [cartLoading, setCartLoading] = useState(true);

  const [street, setStreet]     = useState('');
  const [area,   setArea]       = useState('');
  const [landmark, setLandmark] = useState('');
  const [label,    setLabel]    = useState<LabelChoice>('home');

  const [streetFocused, setStreetFocused] = useState(false);
  const [areaFocused,   setAreaFocused]   = useState(false);

  const [addressId,  setAddressId]  = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Saved-address picker (additive — does not replace the form flow)
  const [addresses,         setAddresses]         = useState<AddressResponse[]>([]);
  const [addressesLoading,  setAddressesLoading]  = useState(true);
  const [showAddressForm,   setShowAddressForm]   = useState(false);

  const [pricing, setPricing] = useState<PricingPreviewResponse | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.COD);
  const [placing,       setPlacing]       = useState(false);

  const placeBtnScale = useRef(new Animated.Value(1)).current;

  useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: t('checkout.title') });
  }, [navigation, t]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void loadCart(); }, [loadCart]);

  useEffect(() => {
    setAddressId(null);
    setPricing(null);
  }, [street, area]);

  // Load saved addresses on mount. If user has any, hide the form by default
  // and auto-select the default. If they have none, fall through to the form.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await api.getAddresses();
        if (!alive) return;
        setAddresses(list);
        if (list.length === 0) {
          setShowAddressForm(true);
        } else {
          const def = list.find((a) => a.isDefault) ?? list[0];
          if (def) void handleSelectSavedAddress(def);
        }
      } catch {
        if (alive) setShowAddressForm(true);
      } finally {
        if (alive) setAddressesLoading(false);
      }
    })();
    return () => { alive = false; };
    // handleSelectSavedAddress is defined below — depend only on cart through that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh pricing whenever the cart finishes loading after we already picked
  // a saved address (initial picker race).
  useEffect(() => {
    if (!cart || !addressId) return;
    if (pricing) return;
    void (async () => {
      try {
        const preview = await api.getPricingPreview({ cartId: cart.cartId, addressId });
        setPricing(preview);
      } catch { /* tolerate */ }
    })();
  }, [cart, addressId, pricing]);

  const handleSelectSavedAddress = useCallback(async (addr: AddressResponse) => {
    setAddressId(addr.id);
    setShowAddressForm(false);
    if (!cart) return;
    try {
      const preview = await api.getPricingPreview({ cartId: cart.cartId, addressId: addr.id });
      setPricing(preview);
    } catch { /* tolerate */ }
  }, [cart]);

  const handleConfirmAddress = useCallback(async () => {
    if (!street.trim() || !area.trim() || !cart) return;
    setConfirming(true);
    try {
      const addr = await api.createAddress({
        label:    LABEL_VALUE[label],
        street:   street.trim(),
        landmark: landmark.trim() || area.trim(),
        locality: area.trim(),
        city:     'Chirawa',
        pincode:  CHIRAWA_PINCODE,
        lat:      CHIRAWA_LAT,
        lng:      CHIRAWA_LNG,
      });
      setAddressId(addr.id);
      // Optimistically include the newly saved address in the picker list
      setAddresses((prev) => [addr, ...prev]);
      const preview = await api.getPricingPreview({ cartId: cart.cartId, addressId: addr.id });
      setPricing(preview);
    } catch {
      Alert.alert(t('common.error'), t('common.retry'));
    } finally {
      setConfirming(false);
    }
  }, [street, area, landmark, label, cart, t]);

  const pulseAndPlace = () => {
    Animated.sequence([
      Animated.spring(placeBtnScale, { toValue: 0.95, friction: 5, tension: 300, useNativeDriver: true }),
      Animated.spring(placeBtnScale, { toValue: 1.05, friction: 5, tension: 300, useNativeDriver: true }),
      Animated.spring(placeBtnScale, { toValue: 1,    friction: 5, tension: 300, useNativeDriver: true }),
    ]).start(() => { void handlePlaceOrder(); });
  };

  const handlePlaceOrder = useCallback(async () => {
    if (!cart) return;
    // Need either a selected address or a filled-in form
    if (!addressId && !street.trim()) return;

    if (paymentMethod !== PaymentMethod.COD) {
      Alert.alert('🚀', t('checkout.comingSoon'));
      return;
    }

    setPlacing(true);
    try {
      let addrId = addressId;
      if (!addrId) {
        const addr = await api.createAddress({
          label:    LABEL_VALUE[label],
          street:   street.trim(),
          landmark: landmark.trim() || area.trim() || street.trim(),
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
  }, [cart, street, area, landmark, label, addressId, paymentMethod, navigation, t]);

  const subtotalRupees  = cart ? Math.round(cart.subtotal / 100) : 0;
  const deliveryRupees  = pricing ? Math.round(pricing.deliveryFee / 100) : null;
  const totalRupees     = pricing ? Math.round(pricing.total / 100) : subtotalRupees;

  const canPlaceOrder   = (!!addressId || (!!street.trim() && !!area.trim())) && !placing && !!cart;
  const canConfirm      = !!street.trim() && !!area.trim() && !confirming;

  const ListHeader = (
    <>
      {/* ── Trust badge ─────────────────────────────────────────────────── */}
      <View style={styles.trustBadge}>
        <Text style={styles.trustBadgeText}>🔒  {t('checkout.trustBadge')}</Text>
      </View>

      {/* ── A. Delivery Address ──────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.addressHeader}>
          <View style={styles.pinCircle}>
            <Text style={styles.pinEmoji}>📍</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>{t('checkout.deliveryAddress')}</Text>
            <Text style={styles.sectionSub}>{t('checkout.chirawa')}</Text>
          </View>
        </View>

        {/* Saved-address picker */}
        {!addressesLoading && addresses.length > 0 && (
          <View style={styles.addressList}>
            {addresses.map((a) => {
              const selected = addressId === a.id;
              return (
                <TouchableOpacity
                  key={a.id}
                  onPress={() => void handleSelectSavedAddress(a)}
                  activeOpacity={0.85}
                  style={[styles.addressCard, selected && styles.addressCardSelected]}
                >
                  <View style={styles.addressCardLeft}>
                    <Text style={styles.addressLabel} numberOfLines={1}>
                      {labelEmoji(a.label)} {a.label ?? 'पता'}
                      {a.isDefault ? '  ·  ' : ''}
                      {a.isDefault ? (
                        <Text style={styles.addressDefaultInline}>
                          {t('address.defaultBadge')}
                        </Text>
                      ) : null}
                    </Text>
                    <Text style={styles.addressStreet} numberOfLines={1}>{a.street}</Text>
                    <Text style={styles.addressArea} numberOfLines={1}>
                      {a.locality}{a.city ? `, ${a.city}` : ''} — {a.pincode}
                    </Text>
                    {a.landmark && a.landmark !== '—' ? (
                      <Text style={styles.addressLandmark} numberOfLines={1}>📌 {a.landmark}</Text>
                    ) : null}
                  </View>
                  {selected ? <Text style={styles.addressCheck}>✓</Text> : null}
                </TouchableOpacity>
              );
            })}

            {!showAddressForm && (
              <TouchableOpacity
                style={styles.addAddressBtn}
                onPress={() => setShowAddressForm(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.addAddressBtnText}>{t('address.addNew')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Address form (always for first-time users; toggleable otherwise) */}
        {showAddressForm && (
          <>
            <View style={styles.chipRow}>
              {(['home', 'work', 'other'] as const).map((k) => {
                const active = label === k;
                const txt = k === 'home' ? t('address.labelHome')
                          : k === 'work' ? t('address.labelWork')
                          : t('address.labelOther');
                return (
                  <TouchableOpacity
                    key={k}
                    onPress={() => setLabel(k)}
                    activeOpacity={0.85}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{txt}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('checkout.streetLabel')}</Text>
              <TextInput
                style={[styles.textInput, streetFocused && styles.textInputFocused]}
                value={street}
                onChangeText={setStreet}
                onFocus={() => setStreetFocused(true)}
                onBlur={() => setStreetFocused(false)}
                placeholder={t('checkout.streetPlaceholder')}
                placeholderTextColor={Colors.textMuted}
                returnKeyType="done"
                autoCapitalize="words"
                blurOnSubmit={true}
                onSubmitEditing={() => Keyboard.dismiss()}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('checkout.areaLabel')}</Text>
              <TextInput
                style={[styles.textInput, areaFocused && styles.textInputFocused]}
                value={area}
                onChangeText={setArea}
                onFocus={() => setAreaFocused(true)}
                onBlur={() => setAreaFocused(false)}
                placeholder={t('checkout.areaPlaceholder')}
                placeholderTextColor={Colors.textMuted}
                returnKeyType="done"
                autoCapitalize="words"
                blurOnSubmit={true}
                onSubmitEditing={() => Keyboard.dismiss()}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('address.landmark')}</Text>
              <TextInput
                style={styles.textInput}
                value={landmark}
                onChangeText={setLandmark}
                placeholder="मंदिर के पास"
                placeholderTextColor={Colors.textMuted}
                returnKeyType="done"
                blurOnSubmit={true}
                onSubmitEditing={() => Keyboard.dismiss()}
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
              activeOpacity={0.85}
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
          </>
        )}
      </View>

      {/* ── B. Order Summary header ──────────────────────────────────────── */}
      <View style={[styles.section, styles.sectionNoBottomPad]}>
        <Text style={styles.sectionTitle}>{t('checkout.orderSummary')}</Text>
        {cart && <Text style={styles.shopNameRow}>🏪 {cart.shopName}</Text>}
      </View>
    </>
  );

  const ListFooter = (
    <>
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
          badge={t('common.comingSoon')}
          onPress={() => Alert.alert('🚀', t('checkout.comingSoon'))}
        />
      </View>

      <View style={[styles.bottomSpacer, { height: 180 + insets.bottom }]} />
    </>
  );

  if (cartLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>{t('common.loading')}</Text>
      </View>
    );
  }

  if (!cart) return null;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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

      {/* ── D. Sticky Place Order ───────────────────────────────────────── */}
      <View style={[styles.stickyBottom, { paddingBottom: Spacing.lg + insets.bottom }]}>
        <View style={styles.orderTotalBar}>
          <Text style={styles.orderTotalLabel}>{t('cart.total')}</Text>
          <Text style={styles.orderTotalValue}>₹{totalRupees}</Text>
        </View>
        <Animated.View style={{ transform: [{ scale: placeBtnScale }] }}>
          <TouchableOpacity
            style={[styles.placeOrderBtn, !canPlaceOrder && styles.placeBtnDisabled]}
            onPress={pulseAndPlace}
            disabled={!canPlaceOrder}
            activeOpacity={0.9}
          >
            {placing ? (
              <LoadingDots />
            ) : (
              <Text style={styles.placeOrderBtnText}>{t('checkout.placeOrder')}</Text>
            )}
          </TouchableOpacity>
        </Animated.View>
        <Text style={styles.secureFooter}>🔒  {t('checkout.securePayment')}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },

  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background, gap: Spacing.md },
  loadingText:      { fontSize: FontSize.md, color: Colors.textLight },

  listContent: { paddingBottom: 0 },

  // Trust badge
  trustBadge: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    backgroundColor: Colors.successLight,
    borderRadius: Radius.full,
    padding: 10,
    alignItems: 'center',
  },
  trustBadgeText: {
    color: Colors.success,
    fontWeight: '600',
    fontSize: FontSize.sm,
  },

  // Section card
  section: {
    backgroundColor: Colors.card, marginHorizontal: Spacing.lg,
    marginTop: Spacing.md, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.md,
    ...Shadow.card,
  },
  sectionNoBottomPad: { paddingBottom: 0 },
  sectionNoTopPad:    { borderTopLeftRadius: 0, borderTopRightRadius: 0, paddingTop: 0, marginTop: 0 },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  sectionSub:   { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '700', marginTop: 2 },

  // Address header
  addressHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
  },
  pinCircle: {
    width: 48, height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pinEmoji: { fontSize: 24 },

  // Saved-address picker
  addressList: { gap: 10, marginTop: 2 },
  addressCard: {
    borderWidth:     1,
    borderColor:     Colors.border,
    borderRadius:    Radius.lg,
    padding:         14,
    backgroundColor: Colors.surface,
    flexDirection:   'row',
    alignItems:      'center',
    gap:             Spacing.sm,
  },
  addressCardSelected: {
    borderWidth:     2,
    borderColor:     Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  addressCardLeft: { flex: 1, gap: 2 },
  addressLabel: {
    fontSize:   FontSize.sm,
    fontWeight: FontWeight.bold,
    color:      Colors.textPrimary,
    marginBottom: 2,
  },
  addressDefaultInline: {
    fontSize:   FontSize.xs,
    color:      Colors.success,
    fontWeight: FontWeight.semibold,
  },
  addressStreet: {
    fontSize:   FontSize.md,
    fontWeight: FontWeight.semibold,
    color:      Colors.textPrimary,
  },
  addressArea: {
    fontSize: FontSize.sm,
    color:    Colors.textSecondary,
  },
  addressLandmark: {
    fontSize: FontSize.xs,
    color:    Colors.textTertiary,
    marginTop: 2,
  },
  addressCheck: {
    fontSize:   FontSize.xl,
    color:      Colors.primary,
    fontWeight: FontWeight.bold,
    marginLeft: 'auto',
  },
  addAddressBtn: {
    borderWidth:    1.5,
    borderColor:    Colors.primary,
    borderStyle:    'dashed',
    borderRadius:   Radius.lg,
    padding:        14,
    alignItems:     'center',
    marginTop:      4,
  },
  addAddressBtnText: {
    color:      Colors.primary,
    fontWeight: FontWeight.semibold,
    fontSize:   FontSize.md,
  },

  // Label chips
  chipRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap', marginBottom: 2 },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   8,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       Colors.border,
    backgroundColor:   Colors.surface,
  },
  chipActive: {
    borderColor:     Colors.primary,
    backgroundColor: Colors.primary,
  },
  chipText:       { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: FontWeight.semibold },
  chipTextActive: { color: Colors.white },

  // Address form
  fieldGroup: { gap: Spacing.xs },
  fieldLabel: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textLight },
  textInput: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    fontSize: FontSize.md, color: Colors.text, backgroundColor: Colors.surface,
    height: 52,
  },
  textInputFocused: { borderColor: Colors.borderFocus },

  // Confirm address button
  confirmAddressBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: Spacing.md, alignItems: 'center',
    minHeight: MIN_TAP, justifyContent: 'center',
  },
  btnDisabled:  { backgroundColor: Colors.disabled },
  btnConfirmed: { backgroundColor: Colors.accent },
  confirmAddressBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },

  // Order summary
  shopNameRow:   { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  summaryItem: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm, backgroundColor: Colors.background,
    minHeight: MIN_TAP, gap: Spacing.md,
  },
  summaryItemName:  { flex: 1, fontSize: FontSize.md, color: Colors.text, fontWeight: '600' },
  summaryItemMeta:  { fontSize: FontSize.md, color: Colors.textSecondary, fontWeight: '600' },
  itemSeparator:    { height: 1, backgroundColor: Colors.border },

  // Pricing
  divider:      { height: 1, backgroundColor: Colors.border, marginBottom: Spacing.xs },
  pricingRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pricingLabel: { fontSize: FontSize.md, color: Colors.textLight },
  pricingValue: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  pricingMuted: { fontSize: FontSize.sm, color: Colors.textMuted, fontStyle: 'italic' },
  totalRow:     { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm, marginTop: Spacing.xs },
  totalLabel:   { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  totalValue:   { fontSize: FontSize.lg, fontWeight: '900', color: Colors.primary },
  breakdownText:{ fontSize: FontSize.sm, color: Colors.textMuted, fontStyle: 'italic', marginTop: Spacing.xs },

  // Payment method cards
  payCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    padding: Spacing.md, minHeight: 72,
  },
  payCardSelected: { borderWidth: 2, borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  payCardLeft:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  payCardRight: { marginLeft: Spacing.sm },
  payCardIcon:  { fontSize: 26 },
  payCardText:  { gap: 2 },
  payCardTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  payCardTitleSelected: { color: Colors.primary },
  payCardHint:  { fontSize: FontSize.sm, color: Colors.textMuted },
  payCheck: {
    color: Colors.primary,
    fontSize: FontSize.xl,
    fontWeight: '900',
  },
  radio: {
    width: 26, height: 26, borderRadius: Radius.full,
    borderWidth: 2, borderColor: Colors.border,
  },
  comingSoonBadge: {
    backgroundColor: Colors.warning, borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: 2,
  },
  comingSoonBadgeText: { fontSize: FontSize.xs, color: Colors.text, fontWeight: '800' },

  bottomSpacer: { height: 180 },

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
  orderTotalLabel: { fontSize: FontSize.md, color: Colors.textLight, fontWeight: '700' },
  orderTotalValue: { fontSize: FontSize.xl, fontWeight: '900', color: Colors.primary },
  placeOrderBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.xl,
    alignItems: 'center',
    height: 56, justifyContent: 'center',
    ...Shadow.primary,
  },
  placeBtnDisabled: { opacity: 0.5 },
  placeOrderBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '900' },
  secureFooter: {
    textAlign: 'center',
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    fontWeight: '700',
    marginTop: 6,
  },

  // Loading dots
  dotsRow: { flexDirection: 'row', gap: 6 },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.white,
  },
});
