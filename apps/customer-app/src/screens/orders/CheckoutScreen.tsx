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
import { Ionicons } from '@expo/vector-icons';
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

// Thumbnail placeholders until product images exist.
const ITEM_COLORS = ['#FFF0E9', '#E8F5E9', '#FFF0F5', '#EDE7F6', '#FFF8E1', '#E6F7F4'];

// ─── Delivery-fee savings nudge (mirrors backend calculateFeeV1 bands) ─────────
// short distance: < ₹100 → ₹20, ₹100–₹300 → ₹15, > ₹300 → ₹10.
function deliveryNudge(subtotalPaise: number, t: (k: string) => string): { text: string; progress: number; done: boolean } {
  if (subtotalPaise < 10000) {
    const amt = Math.ceil((10000 - subtotalPaise) / 100);
    return { text: t('checkout.saveTo15').replace('{amt}', String(amt)), progress: subtotalPaise / 10000, done: false };
  }
  if (subtotalPaise <= 30000) {
    const amt = Math.ceil((30001 - subtotalPaise) / 100);
    return { text: t('checkout.saveTo10').replace('{amt}', String(amt)), progress: subtotalPaise / 30000, done: false };
  }
  return { text: t('checkout.bestRate'), progress: 1, done: true };
}

// ─── Delivery shipment item row (thumbnail + qty stepper + price) ──────────────
function DeliveryItemRow({
  item, color, onQty, busy,
}: { item: CartItem; color: string; onQty: (qty: number) => void; busy: boolean }) {
  return (
    <View style={styles.itemRow}>
      <View style={[styles.itemThumb, { backgroundColor: color }]} />
      <View style={styles.itemMid}>
        <Text style={styles.itemName} numberOfLines={2}>{item.productName}</Text>
        <Text style={styles.itemUnit}>₹{Math.round(item.unitPrice / 100)} each</Text>
      </View>
      <View style={styles.itemRight}>
        <View style={styles.stepper}>
          <TouchableOpacity onPress={() => onQty(item.quantity - 1)} disabled={busy} style={styles.stepBtn} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
            <Ionicons name="remove" size={15} color={Colors.white} />
          </TouchableOpacity>
          <Text style={styles.stepCount}>{busy ? '·' : item.quantity}</Text>
          <TouchableOpacity onPress={() => onQty(item.quantity + 1)} disabled={busy} style={styles.stepBtn} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
            <Ionicons name="add" size={15} color={Colors.white} />
          </TouchableOpacity>
        </View>
        <Text style={styles.itemPrice}>₹{Math.round(item.subtotal / 100)}</Text>
      </View>
    </View>
  );
}

// ─── Payment method card ──────────────────────────────────────────────────────
interface PayCardProps { icon: string; title: string; hint: string; selected: boolean; badge?: string; onPress: () => void }
function PayCard({ icon, title, hint, selected, badge, onPress }: PayCardProps) {
  const checkScale = useRef(new Animated.Value(selected ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(checkScale, { toValue: selected ? 1 : 0, friction: 5, tension: 200, useNativeDriver: true }).start();
  }, [selected, checkScale]);
  return (
    <TouchableOpacity style={[styles.payCard, selected && styles.payCardSelected]} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.payCardLeft}>
        <Text style={styles.payCardIcon}>{icon}</Text>
        <View style={styles.payCardText}>
          <Text style={[styles.payCardTitle, selected && styles.payCardTitleSelected]}>{title}</Text>
          <Text style={styles.payCardHint}>{hint}</Text>
        </View>
      </View>
      <View style={styles.payCardRight}>
        {badge ? (
          <View style={styles.comingSoonBadge}><Text style={styles.comingSoonBadgeText}>{badge}</Text></View>
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
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.timing(val, { toValue: 1, duration: 320, useNativeDriver: true }),
        Animated.timing(val, { toValue: 0.3, duration: 320, useNativeDriver: true }),
      ]));
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

  const [cart, setCart]               = useState<CartResponse | null>(null);
  const [cartLoading, setCartLoading] = useState(true);

  const [street, setStreet]     = useState('');
  const [area,   setArea]       = useState('');
  const [landmark, setLandmark] = useState('');
  const [label,    setLabel]    = useState<LabelChoice>('home');

  const [streetFocused, setStreetFocused] = useState(false);
  const [areaFocused,   setAreaFocused]   = useState(false);

  const [addressId,  setAddressId]  = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const [addresses,        setAddresses]        = useState<AddressResponse[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(true);
  const [showAddressForm,  setShowAddressForm]  = useState(false);

  const [pricing, setPricing] = useState<PricingPreviewResponse | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

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
        Alert.alert(t('cart.empty'), t('cart.emptyHint'), [{ text: t('common.back'), onPress: () => navigation.goBack() }]);
        return;
      }
      setCart(data);
    } catch {
      Alert.alert(t('common.error'), t('common.retry'), [{ text: t('common.back'), onPress: () => navigation.goBack() }]);
    } finally {
      setCartLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void loadCart(); }, [loadCart]);

  useEffect(() => { setAddressId(null); setPricing(null); }, [street, area]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await api.getAddresses();
        if (!alive) return;
        setAddresses(list);
        if (list.length === 0) setShowAddressForm(true);
        else {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cart || !addressId || pricing) return;
    void (async () => {
      try { setPricing(await api.getPricingPreview({ cartId: cart.cartId, addressId })); } catch { /* tolerate */ }
    })();
  }, [cart, addressId, pricing]);

  const handleSelectSavedAddress = useCallback(async (addr: AddressResponse) => {
    setAddressId(addr.id);
    setShowAddressForm(false);
    if (!cart) return;
    try { setPricing(await api.getPricingPreview({ cartId: cart.cartId, addressId: addr.id })); } catch { /* tolerate */ }
  }, [cart]);

  const handleConfirmAddress = useCallback(async () => {
    if (!street.trim() || !area.trim() || !cart) return;
    setConfirming(true);
    try {
      const addr = await api.createAddress({
        label: LABEL_VALUE[label], street: street.trim(),
        landmark: landmark.trim() || area.trim(), locality: area.trim(),
        city: 'Chirawa', pincode: CHIRAWA_PINCODE, lat: CHIRAWA_LAT, lng: CHIRAWA_LNG,
      });
      setAddressId(addr.id);
      setAddresses((prev) => [addr, ...prev]);
      setPricing(await api.getPricingPreview({ cartId: cart.cartId, addressId: addr.id }));
    } catch {
      Alert.alert(t('common.error'), t('common.retry'));
    } finally {
      setConfirming(false);
    }
  }, [street, area, landmark, label, cart, t]);

  // Reload cart (+ pricing) after an in-checkout quantity change.
  const reloadCart = useCallback(async (addrId: string | null) => {
    const data = await api.getCart();
    if (!data || data.items.length === 0) {
      Alert.alert(t('cart.empty'), t('cart.emptyHint'), [{ text: t('common.back'), onPress: () => navigation.goBack() }]);
      return;
    }
    setCart(data);
    if (addrId) {
      try { setPricing(await api.getPricingPreview({ cartId: data.cartId, addressId: addrId })); } catch { /* tolerate */ }
    }
  }, [navigation, t]);

  const changeQty = useCallback(async (productId: string, qty: number) => {
    setUpdatingId(productId);
    try {
      await api.updateCartItem(productId, Math.max(0, qty));
      await reloadCart(addressId);
    } catch (err: unknown) {
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('common.retry'));
    } finally {
      setUpdatingId(null);
    }
  }, [addressId, reloadCart, t]);

  const pulseAndPlace = () => {
    Animated.sequence([
      Animated.spring(placeBtnScale, { toValue: 0.95, friction: 5, tension: 300, useNativeDriver: true }),
      Animated.spring(placeBtnScale, { toValue: 1.05, friction: 5, tension: 300, useNativeDriver: true }),
      Animated.spring(placeBtnScale, { toValue: 1, friction: 5, tension: 300, useNativeDriver: true }),
    ]).start(() => { void handlePlaceOrder(); });
  };

  const handlePlaceOrder = useCallback(async () => {
    if (!cart) return;
    if (!addressId && !street.trim()) return;
    if (paymentMethod !== PaymentMethod.COD) { Alert.alert('🚀', t('checkout.comingSoon')); return; }

    setPlacing(true);
    try {
      let addrId = addressId;
      if (!addrId) {
        const addr = await api.createAddress({
          label: LABEL_VALUE[label], street: street.trim(),
          landmark: landmark.trim() || area.trim() || street.trim(),
          locality: area.trim() || 'Chirawa', city: 'Chirawa',
          pincode: CHIRAWA_PINCODE, lat: CHIRAWA_LAT, lng: CHIRAWA_LNG,
        });
        addrId = addr.id;
      }
      const result = await api.placeOrder({ cartId: cart.cartId, addressId: addrId, paymentMethod: PaymentMethod.COD });
      navigation.replace('OrderTracking', { orderId: result.orderId });
    } catch (err: unknown) {
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('common.error'));
    } finally {
      setPlacing(false);
    }
  }, [cart, street, area, landmark, label, addressId, paymentMethod, navigation, t]);

  const subtotalRupees = cart ? Math.round(cart.subtotal / 100) : 0;
  const deliveryRupees = pricing ? Math.round(pricing.deliveryFee / 100) : null;
  const totalRupees    = pricing ? Math.round(pricing.total / 100) : subtotalRupees;
  const itemCount      = cart ? cart.items.reduce((s, i) => s + i.quantity, 0) : 0;
  const nudge          = cart ? deliveryNudge(cart.subtotal, t) : null;
  const selectedAddr   = addresses.find((a) => a.id === addressId) ?? null;

  const canPlaceOrder = (!!addressId || (!!street.trim() && !!area.trim())) && !placing && !!cart;
  const canConfirm    = !!street.trim() && !!area.trim() && !confirming;

  const ListHeader = (
    <>
      {/* ── Best deal on your cart — delivery savings nudge ──────────────── */}
      {nudge && (
        <View style={styles.section}>
          <Text style={styles.cardTitle}>{t('checkout.bestDeal')}</Text>
          <View style={[styles.nudgeBox, nudge.done && styles.nudgeBoxDone]}>
            <View style={styles.nudgeRow}>
              <Ionicons name={nudge.done ? 'checkmark-circle' : 'bicycle'} size={20} color={Colors.primary} />
              <Text style={styles.nudgeText}>{nudge.text}</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(nudge.progress * 100)}%` }]} />
            </View>
          </View>
        </View>
      )}

      {/* ── Delivery in 30 minutes / shipment header ─────────────────────── */}
      <View style={[styles.section, styles.sectionNoBottomPad]}>
        <View style={styles.deliveryHeader}>
          <View style={styles.clockCircle}>
            <Ionicons name="time-outline" size={20} color={Colors.success} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{t('checkout.deliveryIn30Mins')}</Text>
            <Text style={styles.deliverySub}>
              {t('checkout.shipmentOf')} {itemCount} {itemCount === 1 ? t('cart.itemOne') : t('cart.itemMany')}
            </Text>
          </View>
        </View>
      </View>
    </>
  );

  const ListFooter = (
    <>
      {/* ── Bill summary ─────────────────────────────────────────────────── */}
      <View style={[styles.section, styles.sectionNoTopPad]}>
        <View style={styles.divider} />
        <View style={styles.pricingRow}>
          <Text style={styles.pricingLabel}>{t('cart.subtotal')}</Text>
          <Text style={styles.pricingValue}>₹{subtotalRupees}</Text>
        </View>
        <View style={styles.pricingRow}>
          <Text style={styles.pricingLabel}>{t('cart.deliveryFee')}</Text>
          {deliveryRupees === null
            ? <Text style={styles.pricingMuted}>{t('checkout.confirmToSee')}</Text>
            : <Text style={styles.pricingValue}>₹{deliveryRupees}</Text>}
        </View>
        <View style={[styles.pricingRow, styles.totalRow]}>
          <Text style={styles.totalLabel}>{t('cart.total')}</Text>
          <Text style={styles.totalValue}>₹{totalRupees}</Text>
        </View>
      </View>

      {/* ── Delivery Address ─────────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.addressHeader}>
          <View style={styles.pinCircle}><Ionicons name="location" size={22} color={Colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{t('checkout.deliveryAddress')}</Text>
            <Text style={styles.sectionSub}>{t('checkout.chirawa')}</Text>
          </View>
        </View>

        {!addressesLoading && addresses.length > 0 && (
          <View style={styles.addressList}>
            {addresses.map((a) => {
              const selected = addressId === a.id;
              return (
                <TouchableOpacity key={a.id} onPress={() => void handleSelectSavedAddress(a)} activeOpacity={0.85}
                  style={[styles.addressCard, selected && styles.addressCardSelected]}>
                  <View style={styles.addressCardLeft}>
                    <Text style={styles.addressLabel} numberOfLines={1}>
                      {labelEmoji(a.label)} {a.label ?? 'पता'}
                      {a.isDefault ? '  ·  ' : ''}
                      {a.isDefault ? <Text style={styles.addressDefaultInline}>{t('address.defaultBadge')}</Text> : null}
                    </Text>
                    <Text style={styles.addressStreet} numberOfLines={1}>{a.street}</Text>
                    <Text style={styles.addressArea} numberOfLines={1}>{a.locality}{a.city ? `, ${a.city}` : ''} — {a.pincode}</Text>
                  </View>
                  {selected ? <Text style={styles.addressCheck}>✓</Text> : null}
                </TouchableOpacity>
              );
            })}
            {!showAddressForm && (
              <TouchableOpacity style={styles.addAddressBtn} onPress={() => setShowAddressForm(true)} activeOpacity={0.7}>
                <Text style={styles.addAddressBtnText}>{t('address.addNew')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {showAddressForm && (
          <>
            <View style={styles.chipRow}>
              {(['home', 'work', 'other'] as const).map((k) => {
                const active = label === k;
                const txt = k === 'home' ? t('address.labelHome') : k === 'work' ? t('address.labelWork') : t('address.labelOther');
                return (
                  <TouchableOpacity key={k} onPress={() => setLabel(k)} activeOpacity={0.85} style={[styles.chip, active && styles.chipActive]}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{txt}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('checkout.streetLabel')}</Text>
              <TextInput style={[styles.textInput, streetFocused && styles.textInputFocused]} value={street} onChangeText={setStreet}
                onFocus={() => setStreetFocused(true)} onBlur={() => setStreetFocused(false)} placeholder={t('checkout.streetPlaceholder')}
                placeholderTextColor={Colors.textMuted} returnKeyType="done" autoCapitalize="words" blurOnSubmit onSubmitEditing={() => Keyboard.dismiss()} />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('checkout.areaLabel')}</Text>
              <TextInput style={[styles.textInput, areaFocused && styles.textInputFocused]} value={area} onChangeText={setArea}
                onFocus={() => setAreaFocused(true)} onBlur={() => setAreaFocused(false)} placeholder={t('checkout.areaPlaceholder')}
                placeholderTextColor={Colors.textMuted} returnKeyType="done" autoCapitalize="words" blurOnSubmit onSubmitEditing={() => Keyboard.dismiss()} />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('address.landmark')}</Text>
              <TextInput style={styles.textInput} value={landmark} onChangeText={setLandmark} placeholder="मंदिर के पास"
                placeholderTextColor={Colors.textMuted} returnKeyType="done" blurOnSubmit onSubmitEditing={() => Keyboard.dismiss()} />
            </View>
            <TouchableOpacity style={[styles.confirmAddressBtn, !canConfirm && styles.btnDisabled, addressId && styles.btnConfirmed]}
              onPress={() => void handleConfirmAddress()} disabled={!canConfirm} activeOpacity={0.85}>
              {confirming ? <ActivityIndicator color={Colors.white} size="small" />
                : <Text style={styles.confirmAddressBtnText}>{addressId ? `✓  ${t('checkout.addressConfirmed')}` : t('checkout.confirmAddress')}</Text>}
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* ── Payment Method ───────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.cardTitle}>{t('checkout.paymentMethod')}</Text>
        <PayCard icon="💵" title={t('checkout.cod')} hint={t('checkout.codHint')} selected={paymentMethod === PaymentMethod.COD} onPress={() => setPaymentMethod(PaymentMethod.COD)} />
        <PayCard icon="📱" title={t('checkout.payOnline')} hint={t('checkout.onlineHint')} selected={false} badge={t('common.comingSoon')} onPress={() => Alert.alert('🚀', t('checkout.comingSoon'))} />
      </View>

      <View style={[styles.bottomSpacer, { height: 190 + insets.bottom }]} />
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
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={88}>
      <FlatList
        data={cart.items}
        keyExtractor={(item) => item.productId}
        renderItem={({ item, index }) => (
          <DeliveryItemRow
            item={item}
            color={ITEM_COLORS[index % ITEM_COLORS.length]}
            busy={updatingId === item.productId}
            onQty={(q) => void changeQty(item.productId, q)}
          />
        )}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        style={styles.flex}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      />

      {/* ── Sticky bottom: address summary + PAY USING + Place Order ──────── */}
      <View style={[styles.stickyBottom, { paddingBottom: Spacing.md + insets.bottom }]}>
        {/* address summary bar */}
        <TouchableOpacity
          style={styles.addrBar}
          activeOpacity={0.7}
          onPress={() => setShowAddressForm(true)}
        >
          <Ionicons name="home" size={20} color={Colors.primary} />
          <View style={{ flex: 1 }}>
            {selectedAddr ? (
              <>
                <Text style={styles.addrBarTitle} numberOfLines={1}>
                  {t('checkout.deliveringTo')} <Text style={styles.addrBarBold}>{selectedAddr.label ?? 'Home'}</Text>
                </Text>
                <Text style={styles.addrBarSub} numberOfLines={1}>{selectedAddr.street}, {selectedAddr.locality}</Text>
              </>
            ) : (
              <Text style={styles.addrBarTitle} numberOfLines={1}>{t('address.selectAddress')}</Text>
            )}
          </View>
          <Text style={styles.addrChange}>{t('checkout.change')}</Text>
        </TouchableOpacity>

        {/* pay using + place order */}
        <View style={styles.payRow}>
          <View style={styles.payUsing}>
            <Text style={styles.payUsingLabel}>{t('checkout.payUsing')}</Text>
            <Text style={styles.payUsingValue} numberOfLines={1}>{t('checkout.cod')}</Text>
          </View>
          <Animated.View style={{ transform: [{ scale: placeBtnScale }], flex: 1 }}>
            <TouchableOpacity style={[styles.placeOrderBtn, !canPlaceOrder && styles.placeBtnDisabled]} onPress={pulseAndPlace} disabled={!canPlaceOrder} activeOpacity={0.9}>
              {placing ? <LoadingDots /> : (
                <>
                  <View>
                    <Text style={styles.placeTotalRs}>₹{totalRupees}</Text>
                    <Text style={styles.placeTotalLabel}>{t('cart.total')}</Text>
                  </View>
                  <View style={styles.placeCta}>
                    <Text style={styles.placeOrderBtnText}>{t('checkout.placeOrder')}</Text>
                    <Ionicons name="chevron-forward" size={18} color={Colors.white} />
                  </View>
                </>
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background, gap: Spacing.md },
  loadingText: { fontSize: FontSize.md, color: Colors.textLight },
  listContent: { paddingBottom: 0 },

  section: {
    backgroundColor: Colors.card, marginHorizontal: Spacing.lg, marginTop: Spacing.md,
    borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.md, ...Shadow.card,
  },
  sectionNoBottomPad: { paddingBottom: Spacing.md },
  sectionNoTopPad: { marginTop: Spacing.md },
  cardTitle: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  sectionSub: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '700', marginTop: 2 },

  // Savings nudge
  nudgeBox: { backgroundColor: Colors.primaryLight, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  nudgeBoxDone: { backgroundColor: Colors.successLight },
  nudgeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  nudgeText: { flex: 1, fontSize: FontSize.sm, color: Colors.text, fontWeight: '700' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.08)', overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: Colors.primary },

  // Delivery header
  deliveryHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  clockCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.successLight, justifyContent: 'center', alignItems: 'center' },
  deliverySub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },

  // Delivery item rows
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, marginHorizontal: Spacing.lg, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
  },
  itemThumb: { width: 48, height: 48, borderRadius: 10 },
  itemMid: { flex: 1, gap: 2 },
  itemName: { fontSize: FontSize.md, color: Colors.text, fontWeight: '600' },
  itemUnit: { fontSize: FontSize.xs, color: Colors.textMuted },
  itemRight: { alignItems: 'flex-end', gap: 6 },
  stepper: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.primary,
    borderRadius: Radius.md, paddingHorizontal: 4, height: 30,
  },
  stepBtn: { width: 26, alignItems: 'center', justifyContent: 'center' },
  stepCount: { minWidth: 20, textAlign: 'center', color: Colors.white, fontWeight: '800', fontSize: FontSize.sm },
  itemPrice: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },

  // Address header
  addressHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  pinCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primaryLight, justifyContent: 'center', alignItems: 'center' },

  addressList: { gap: 10, marginTop: 2 },
  addressCard: { borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, padding: 14, backgroundColor: Colors.surface, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  addressCardSelected: { borderWidth: 2, borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  addressCardLeft: { flex: 1, gap: 2 },
  addressLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.textPrimary, marginBottom: 2 },
  addressDefaultInline: { fontSize: FontSize.xs, color: Colors.success, fontWeight: FontWeight.semibold },
  addressStreet: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  addressArea: { fontSize: FontSize.sm, color: Colors.textSecondary },
  addressCheck: { fontSize: FontSize.xl, color: Colors.primary, fontWeight: FontWeight.bold, marginLeft: 'auto' },
  addAddressBtn: { borderWidth: 1.5, borderColor: Colors.primary, borderStyle: 'dashed', borderRadius: Radius.lg, padding: 14, alignItems: 'center', marginTop: 4 },
  addAddressBtnText: { color: Colors.primary, fontWeight: FontWeight.semibold, fontSize: FontSize.md },

  chipRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap', marginBottom: 2 },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  chipActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: FontWeight.semibold },
  chipTextActive: { color: Colors.white },

  fieldGroup: { gap: Spacing.xs },
  fieldLabel: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textLight },
  textInput: { borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md, fontSize: FontSize.md, color: Colors.text, backgroundColor: Colors.surface, height: 52 },
  textInputFocused: { borderColor: Colors.borderFocus },

  confirmAddressBtn: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.md, alignItems: 'center', minHeight: MIN_TAP, justifyContent: 'center' },
  btnDisabled: { backgroundColor: Colors.disabled },
  btnConfirmed: { backgroundColor: Colors.success },
  confirmAddressBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },

  // Pricing
  divider: { height: 1, backgroundColor: Colors.border, marginBottom: Spacing.xs },
  pricingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pricingLabel: { fontSize: FontSize.md, color: Colors.textLight },
  pricingValue: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  pricingMuted: { fontSize: FontSize.sm, color: Colors.textMuted, fontStyle: 'italic' },
  totalRow: { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm, marginTop: Spacing.xs },
  totalLabel: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  totalValue: { fontSize: FontSize.lg, fontWeight: '900', color: Colors.primary },

  // Payment cards
  payCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, backgroundColor: Colors.surface, padding: Spacing.md, minHeight: 72 },
  payCardSelected: { borderWidth: 2, borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  payCardLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  payCardRight: { marginLeft: Spacing.sm },
  payCardIcon: { fontSize: 26 },
  payCardText: { gap: 2 },
  payCardTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  payCardTitleSelected: { color: Colors.primary },
  payCardHint: { fontSize: FontSize.sm, color: Colors.textMuted },
  payCheck: { color: Colors.primary, fontSize: FontSize.xl, fontWeight: '900' },
  radio: { width: 26, height: 26, borderRadius: Radius.full, borderWidth: 2, borderColor: Colors.border },
  comingSoonBadge: { backgroundColor: Colors.warning, borderRadius: Radius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  comingSoonBadgeText: { fontSize: FontSize.xs, color: Colors.text, fontWeight: '800' },

  bottomSpacer: { height: 190 },

  // Sticky bottom
  stickyBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.white,
    borderTopWidth: 1, borderTopColor: Colors.border, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, gap: Spacing.md,
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 8,
  },
  addrBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  addrBarTitle: { fontSize: FontSize.sm, color: Colors.text },
  addrBarBold: { fontWeight: '800' },
  addrBarSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },
  addrChange: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '800' },

  payRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  payUsing: { width: 96 },
  payUsingLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '700', letterSpacing: 0.5 },
  payUsingValue: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '700', marginTop: 1 },
  placeOrderBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.primary, borderRadius: Radius.lg, height: 56, paddingHorizontal: Spacing.lg, ...Shadow.primary,
  },
  placeBtnDisabled: { opacity: 0.5 },
  placeTotalRs: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '900', lineHeight: 20 },
  placeTotalLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  placeCta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  placeOrderBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '900' },

  dotsRow: { flexDirection: 'row', gap: 6, alignSelf: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.white },
});
