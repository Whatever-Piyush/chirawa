import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { FontSize, FontWeight, Gradients, MIN_TAP, Radius, Shadow, Spacing } from '../../theme';
import { FauxGradient } from '../../components/ui';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { isOpenNow } from '../../utils/operatingHours';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';
import { useAuth } from '../../context/AuthContext';
import { type RazorpaySuccess } from '../../components/payment/RazorpayCheckout';
import ProductCard, { type ProductCardData } from '../../components/product/ProductCard';
import { fetchProducts, toProductCard } from '../../services/catalog';

// Tip presets for the delivery partner (UI selection; wired to the charge in the
// backend phase). Amounts in rupees, each with a little delight emoji.
const TIP_PRESETS = [
  { amt: 20, emoji: '🙂' },
  { amt: 30, emoji: '😄' },
  { amt: 50, emoji: '🤩' },
] as const;

// Multi-select delivery instructions.
const DELIVERY_INSTRUCTIONS = [
  { key: 'avoid_calling',  icon: 'call-outline',          labelKey: 'checkout.instrAvoidCalling' },
  { key: 'dont_ring',      icon: 'notifications-off-outline', labelKey: 'checkout.instrDontRing' },
  { key: 'leave_at_door',  icon: 'home-outline',          labelKey: 'checkout.instrLeaveAtDoor' },
] as const;

// Lazy-loaded so `react-native-webview` (a native module) is only required when
// the Razorpay sheet actually opens. Keeps the app bootable on a dev client that
// predates the webview native module — only online payment needs the rebuild.
const RazorpayCheckout = React.lazy(() => import('../../components/payment/RazorpayCheckout'));

type LabelChoice = 'home' | 'work' | 'other';
const LABEL_VALUE: Record<LabelChoice, string> = { home: 'घर', work: 'दुकान', other: 'अन्य' };
function labelEmoji(label?: string | null): string {
  if (label === 'घर')   return '🏠';
  if (label === 'दुकान') return '🏪';
  return '📍';
}

// Addresses store their label as a Hindi string ('घर'); show it in the active
// language (and without the emoji, since the card already renders an icon tile).
function labelDisplay(label: string | null | undefined, t: (k: string) => string): string {
  if (label === 'घर')   return t('address.typeHome');
  if (label === 'दुकान') return t('address.typeWork');
  if (label === 'अन्य')  return t('address.typeOther');
  return label ?? t('address.typeOther');
}

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Checkout'> };

const CHIRAWA_LAT     = 28.2330;
const CHIRAWA_LNG     = 75.6307;
const CHIRAWA_PINCODE = '333026';

// Thumbnail placeholders until product images exist.
const ITEM_COLORS = ['#FFF0E9', '#E8F5E9', '#FFF0F5', '#EDE7F6', '#FFF8E1', '#E6F7F4'];

// ─── Delivery-fee savings nudge (mirrors backend flat pricing) ─────────────────
// Flat Chirawa pricing: cart < ₹100 → ₹25, cart ≥ ₹100 → ₹10 (₹15 on Chirawa
// Special). Below ₹100 we nudge the customer to reach ₹100 and pay ₹10.
function deliveryNudge(subtotalPaise: number, t: (k: string) => string): { text: string; progress: number; done: boolean } {
  if (subtotalPaise < 10000) {
    const amt = Math.ceil((10000 - subtotalPaise) / 100);
    return { text: t('checkout.saveTo10').replace('{amt}', String(amt)), progress: subtotalPaise / 10000, done: false };
  }
  return { text: t('checkout.bestRate'), progress: 1, done: true };
}

// ─── Delivery shipment item row (thumbnail + qty stepper + price) ──────────────
function DeliveryItemRow({
  item, color, onQty, busy,
}: { item: CartItem; color: string; onQty: (qty: number) => void; busy: boolean }) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
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

// ─── Animated dots loading indicator ──────────────────────────────────────────
function LoadingDots() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
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
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const { state: authState } = useAuth();

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

  // Razorpay checkout (online payment). Non-null = the sheet is open for this order.
  const [rzpData, setRzpData] = useState<{
    orderId: string; keyId: string; razorpayOrderId: string; amountPaise: number;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Promo code (Chunk 7.3). `promoCode` is the applied code; the ref lets every
  // pricing-preview call site read the current code without re-threading deps.
  const [promoInput, setPromoInput] = useState('');
  const [promoCode,  setPromoCode]  = useState('');
  const [promoBusy,  setPromoBusy]  = useState(false);
  const promoCodeRef = useRef('');

  // ── Phase B extras (UI; charge/persistence wired in the backend phase) ──────
  const [alsoLike,    setAlsoLike]    = useState<ProductCardData[]>([]);
  const [tip,         setTip]         = useState<number | null>(null);
  const [customTipOpen, setCustomTipOpen] = useState(false);
  const [instructions, setInstructions] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    fetchProducts({ limit: 6 })
      .then((p) => { if (active) setAlsoLike(p.map(toProductCard)); })
      .catch(() => { /* tolerate — section hides */ });
    return () => { active = false; };
  }, []);

  const toggleInstruction = useCallback((key: string) => {
    setInstructions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

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

  // Single pricing-preview entry point — always sends the currently applied promo
  // code (if any). Server soft-fails a bad code into `promoError` and still bills.
  const fetchPricing = useCallback(
    (cartId: string, addrId: string) =>
      api.getPricingPreview({ cartId, addressId: addrId, promoCode: promoCodeRef.current || undefined }),
    [],
  );

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
      try { setPricing(await fetchPricing(cart.cartId, addressId)); } catch { /* tolerate */ }
    })();
  }, [cart, addressId, pricing, fetchPricing]);

  const handleSelectSavedAddress = useCallback(async (addr: AddressResponse) => {
    setAddressId(addr.id);
    setShowAddressForm(false);
    if (!cart) return;
    try { setPricing(await fetchPricing(cart.cartId, addr.id)); } catch { /* tolerate */ }
  }, [cart, fetchPricing]);

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
      setPricing(await fetchPricing(cart.cartId, addr.id));
    } catch {
      Alert.alert(t('common.error'), t('common.retry'));
    } finally {
      setConfirming(false);
    }
  }, [street, area, landmark, label, cart, t, fetchPricing]);

  // Reload cart (+ pricing) after an in-checkout quantity change.
  const reloadCart = useCallback(async (addrId: string | null) => {
    const data = await api.getCart();
    if (!data || data.items.length === 0) {
      Alert.alert(t('cart.empty'), t('cart.emptyHint'), [{ text: t('common.back'), onPress: () => navigation.goBack() }]);
      return;
    }
    setCart(data);
    if (addrId) {
      try { setPricing(await fetchPricing(data.cartId, addrId)); } catch { /* tolerate */ }
    }
  }, [navigation, t, fetchPricing]);

  // Apply / clear the typed promo code, then refresh the bill.
  const applyPromo = useCallback(async () => {
    if (!cart || !addressId) return;
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    promoCodeRef.current = code;
    setPromoCode(code);
    setPromoBusy(true);
    try { setPricing(await fetchPricing(cart.cartId, addressId)); } catch { /* tolerate */ }
    finally { setPromoBusy(false); }
  }, [cart, addressId, promoInput, fetchPricing]);

  const removePromo = useCallback(async () => {
    promoCodeRef.current = '';
    setPromoCode('');
    setPromoInput('');
    if (!cart || !addressId) return;
    setPromoBusy(true);
    try { setPricing(await fetchPricing(cart.cartId, addressId)); } catch { /* tolerate */ }
    finally { setPromoBusy(false); }
  }, [cart, addressId, fetchPricing]);

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
      const result = await api.placeOrder({
        cartId: cart.cartId, addressId: addrId, paymentMethod,
        ...(promoCodeRef.current ? { promoCode: promoCodeRef.current } : {}),
      });

      if (paymentMethod === PaymentMethod.COD) {
        navigation.replace('OrderPlaced', { orderId: result.orderId });
        return;
      }

      // Online payment → open Razorpay checkout for the just-created order.
      if (result.razorpayOrderId && result.razorpayKeyId) {
        setRzpData({
          orderId:         result.orderId,
          keyId:           result.razorpayKeyId,
          razorpayOrderId: result.razorpayOrderId,
          amountPaise:     result.amountPaise ?? result.totalAmount,
        });
      } else {
        Alert.alert(t('common.error'), t('checkout.paymentInitFailed'));
      }
    } catch (err: unknown) {
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('common.error'));
    } finally {
      setPlacing(false);
    }
  }, [cart, street, area, landmark, label, addressId, paymentMethod, navigation, t]);

  // Razorpay returned a successful payment → re-verify server-side, then go to
  // tracking. The order already exists (pending_payment); verify flips it to paid.
  const handlePaymentSuccess = useCallback(async (r: RazorpaySuccess) => {
    const data = rzpData;
    setRzpData(null);
    if (!data) return;
    setVerifying(true);
    try {
      await api.verifyPayment(data.orderId, {
        razorpayOrderId:   r.razorpayOrderId,
        razorpayPaymentId: r.razorpayPaymentId,
        razorpaySignature: r.razorpaySignature,
      });
      navigation.replace('OrderPlaced', { orderId: data.orderId });
    } catch (err: unknown) {
      Alert.alert(t('checkout.paymentFailed'), err instanceof Error ? err.message : t('checkout.paymentFailed'));
    } finally {
      setVerifying(false);
    }
  }, [rzpData, navigation, t]);

  const handlePaymentDismiss = useCallback(() => {
    setRzpData(null);
    Alert.alert(t('checkout.paymentCancelledTitle'), t('checkout.paymentCancelledBody'));
  }, [t]);

  const handlePaymentError = useCallback((msg: string) => {
    setRzpData(null);
    Alert.alert(t('checkout.paymentFailed'), msg);
  }, [t]);

  const subtotalRupees = cart ? Math.round(cart.subtotal / 100) : 0;
  const deliveryRupees = pricing ? Math.round(pricing.deliveryFee / 100) : null;
  const discountRupees = pricing && pricing.discount > 0 ? Math.round(pricing.discount / 100) : 0;
  const totalRupees    = pricing ? Math.round(pricing.total / 100) : subtotalRupees;
  // A typed code is "active" only once the server confirms it produced a discount.
  const promoActive    = !!promoCode && !!pricing?.appliedPromoCode;
  const itemCount      = cart ? cart.items.reduce((s, i) => s + i.quantity, 0) : 0;
  const nudge          = cart ? deliveryNudge(cart.subtotal, t) : null;
  const selectedAddr   = addresses.find((a) => a.id === addressId) ?? null;

  const withinHours   = isOpenNow();
  const canPlaceOrder = (!!addressId || (!!street.trim() && !!area.trim())) && !placing && !!cart && withinHours;
  const canConfirm    = !!street.trim() && !!area.trim() && !confirming;

  const ListHeader = (
    <>
      {/* ── Order for {name}, {phone} ────────────────────────────────────── */}
      <View style={[styles.section, styles.orderForCard]}>
        <View style={styles.orderForIcon}>
          <Ionicons name="person" size={18} color={Colors.primary} />
        </View>
        <Text style={styles.orderForText} numberOfLines={1}>
          {t('checkout.orderFor')}{' '}
          <Text style={styles.orderForName}>
            {authState.name ?? 'You'}{authState.phone ? `, ${authState.phone}` : ''}
          </Text>
        </Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('EditProfile')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
        >
          <Text style={styles.orderForChange}>{t('checkout.change')}</Text>
        </TouchableOpacity>
      </View>

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
      {/* ── You might also like ──────────────────────────────────────────── */}
      {alsoLike.length > 0 && (
        <View style={styles.alsoSection}>
          <Text style={styles.cardTitle}>{t('product.frequentlyBought')}</Text>
          <View style={styles.alsoGrid}>
            {alsoLike.map((p) => <ProductCard key={p.productId} product={p} size="compact" />)}
          </View>
        </View>
      )}

      {/* ── Bill details ─────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.cardTitle}>{t('checkout.billDetails')}</Text>

        <View style={styles.billRow}>
          <View style={styles.billLabelWrap}>
            <Ionicons name="receipt-outline" size={16} color={Colors.textSecondary} />
            <Text style={styles.billLabel}>{t('checkout.itemsTotal')}</Text>
          </View>
          <Text style={styles.billValue}>₹{subtotalRupees}</Text>
        </View>

        <View style={styles.billRow}>
          <View style={styles.billLabelWrap}>
            <Ionicons name="bicycle-outline" size={17} color={Colors.textSecondary} />
            <Text style={styles.billLabel}>{t('cart.deliveryFee')}</Text>
          </View>
          {deliveryRupees === null
            ? <Text style={styles.pricingMuted}>{t('checkout.confirmToSee')}</Text>
            : deliveryRupees === 0
              ? <Text style={styles.billFree}>FREE</Text>
              : <Text style={styles.billValue}>₹{deliveryRupees}</Text>}
        </View>
        {nudge && !nudge.done && <Text style={styles.billNudge}>{nudge.text}</Text>}

        {discountRupees > 0 && (
          <View style={styles.billRow}>
            <View style={styles.billLabelWrap}>
              <Ionicons name="pricetag-outline" size={16} color={Colors.success} />
              <Text style={[styles.billLabel, { color: Colors.success }]}>
                {t('checkout.discount')}{pricing?.appliedPromoCode ? ` · ${pricing.appliedPromoCode}` : ''}
              </Text>
            </View>
            <Text style={[styles.billValue, { color: Colors.success }]}>− ₹{discountRupees}</Text>
          </View>
        )}

        <View style={styles.billDivider} />
        <View style={styles.billTotalRow}>
          <Text style={styles.billTotalLabel}>{t('checkout.grandTotal')}</Text>
          <Text style={styles.billTotalValue}>₹{totalRupees}</Text>
        </View>
      </View>

      {/* ── Payment Method ───────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.cardTitle}>{t('checkout.paymentMethod')}</Text>
        {([
          { method: PaymentMethod.COD, icon: 'cash-outline',  title: t('checkout.cod'),       hint: t('checkout.codHint') },
          { method: PaymentMethod.UPI, icon: 'card-outline',  title: t('checkout.payOnline'), hint: t('checkout.onlineHint') },
        ] as const).map((opt) => {
          const selected = paymentMethod === opt.method;
          return (
            <TouchableOpacity
              key={opt.method}
              style={[styles.payOption, selected && styles.payOptionSelected]}
              onPress={() => setPaymentMethod(opt.method)}
              activeOpacity={0.8}
            >
              <Ionicons name={opt.icon} size={22} color={selected ? Colors.primary : Colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.payOptionTitle}>{opt.title}</Text>
                <Text style={styles.payOptionHint}>{opt.hint}</Text>
              </View>
              <View style={[styles.payRadio, selected && styles.payRadioSelected]}>
                {selected && <View style={styles.payRadioDot} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Delivery instructions ────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.cardTitle}>{t('checkout.deliveryInstructions')}</Text>
        <View style={styles.instrRow}>
          {DELIVERY_INSTRUCTIONS.map((d) => {
            const on = instructions.has(d.key);
            return (
              <TouchableOpacity
                key={d.key}
                activeOpacity={0.85}
                onPress={() => toggleInstruction(d.key)}
                style={[styles.instrCard, on && styles.instrCardOn]}
              >
                {on && (
                  <View style={styles.instrCheck}>
                    <Ionicons name="checkmark" size={11} color={Colors.white} />
                  </View>
                )}
                <View style={[styles.instrIconCircle, on && styles.instrIconCircleOn]}>
                  <Ionicons name={d.icon as never} size={20} color={on ? Colors.primary : Colors.textSecondary} />
                </View>
                <Text style={[styles.instrLabel, on && styles.instrLabelOn]}>{t(d.labelKey)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── Tip your delivery partner ────────────────────────────────────── */}
      <View style={styles.tipSection}>
        <FauxGradient from={Gradients.warm[0]} to={Gradients.warm[1]} steps={10} style={styles.tipBanner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.tipTitle}>{t('checkout.tipTitle')}</Text>
            <Text style={styles.tipSub}>{t('checkout.tipSub')}</Text>
          </View>
          <View style={styles.tipScooter}>
            <Ionicons name="bicycle" size={30} color={Colors.white} />
          </View>
        </FauxGradient>

        <View style={styles.tipBody}>
          <View style={styles.tipChips}>
            {TIP_PRESETS.map(({ amt, emoji }) => {
              const on = tip === amt && !customTipOpen;
              return (
                <TouchableOpacity
                  key={amt}
                  activeOpacity={0.85}
                  onPress={() => { setCustomTipOpen(false); setTip(on ? null : amt); }}
                  style={[styles.tipChip, on && styles.tipChipOn]}
                >
                  <Text style={styles.tipEmoji}>{emoji}</Text>
                  <Text style={[styles.tipChipText, on && styles.tipChipTextOn]}>₹{amt}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => { setCustomTipOpen((v) => !v); setTip(null); }}
              style={[styles.tipChip, customTipOpen && styles.tipChipOn]}
            >
              <Text style={styles.tipEmoji}>✨</Text>
              <Text style={[styles.tipChipText, customTipOpen && styles.tipChipTextOn]}>{t('checkout.tipCustom')}</Text>
            </TouchableOpacity>
          </View>

          {customTipOpen && (
            <View style={styles.tipCustomRow}>
              <Text style={styles.tipCustomRupee}>₹</Text>
              <TextInput
                style={styles.tipCustomInput}
                keyboardType="number-pad"
                value={tip != null ? String(tip) : ''}
                onChangeText={(v) => setTip(v ? Math.max(0, parseInt(v.replace(/[^0-9]/g, ''), 10) || 0) : null)}
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                maxLength={4}
              />
            </View>
          )}

          {tip != null && tip > 0 && (
            <View style={styles.tipThanksRow}>
              <Ionicons name="heart" size={14} color={Colors.success} />
              <Text style={styles.tipThanks}>{t('checkout.tipThanks')}</Text>
            </View>
          )}
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
                <TouchableOpacity key={a.id} onPress={() => void handleSelectSavedAddress(a)} activeOpacity={0.9}
                  style={[styles.addressCard, selected && styles.addressCardSelected]}>
                  {selected && <View style={styles.addrAccent} />}

                  <View style={[styles.addrTypeTile, selected && styles.addrTypeTileOn]}>
                    <Text style={styles.addrTypeEmoji}>{labelEmoji(a.label)}</Text>
                  </View>

                  <View style={styles.addressCardLeft}>
                    <View style={styles.addrLabelRow}>
                      <Text style={styles.addressLabel} numberOfLines={1}>{labelDisplay(a.label, t)}</Text>
                      {a.isDefault && (
                        <View style={styles.defaultPill}>
                          <Text style={styles.defaultPillText}>{t('address.defaultBadge')}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.addressStreet} numberOfLines={1}>{a.street}</Text>
                    <Text style={styles.addressArea} numberOfLines={1}>{a.locality}{a.city ? `, ${a.city}` : ''} — {a.pincode}</Text>
                  </View>

                  <View style={[styles.addrRadio, selected && styles.addrRadioOn]}>
                    {selected && <Ionicons name="checkmark" size={14} color={Colors.white} />}
                  </View>
                </TouchableOpacity>
              );
            })}
            {!showAddressForm && (
              <TouchableOpacity style={styles.addAddressBtn} onPress={() => setShowAddressForm(true)} activeOpacity={0.8}>
                <View style={styles.addPlusCircle}>
                  <Ionicons name="add" size={20} color={Colors.primary} />
                </View>
                <Text style={styles.addAddressBtnText}>{t('address.addNew')}</Text>
                <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
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

      {/* ── Promo code (Chunk 7.3) ───────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.cardTitle}>{t('checkout.promoTitle')}</Text>
        {promoActive ? (
          <View style={styles.promoAppliedRow}>
            <Ionicons name="pricetag" size={18} color={Colors.success} />
            <Text style={styles.promoAppliedText} numberOfLines={1}>
              {pricing?.appliedPromoCode} {t('checkout.promoApplied')}
            </Text>
            <TouchableOpacity onPress={() => void removePromo()} disabled={promoBusy} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.promoRemove}>{t('checkout.promoRemove')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.promoRow}>
            <TextInput
              style={styles.promoInput}
              value={promoInput}
              onChangeText={setPromoInput}
              placeholder={t('checkout.promoPlaceholder')}
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!!addressId && !promoBusy}
              returnKeyType="done"
              onSubmitEditing={() => void applyPromo()}
            />
            <TouchableOpacity
              style={[styles.promoApplyBtn, (!addressId || !promoInput.trim() || promoBusy) && styles.btnDisabled]}
              onPress={() => void applyPromo()}
              disabled={!addressId || !promoInput.trim() || promoBusy}
              activeOpacity={0.85}
            >
              {promoBusy ? <ActivityIndicator color={Colors.white} size="small" />
                : <Text style={styles.promoApplyText}>{t('checkout.apply')}</Text>}
            </TouchableOpacity>
          </View>
        )}
        {!addressId && <Text style={styles.promoHint}>{t('checkout.confirmToSee')}</Text>}
        {pricing?.promoError ? <Text style={styles.promoError}>{pricing.promoError}</Text> : null}
        {!promoCode && pricing?.appliedPromoCode ? (
          <Text style={styles.promoAutoNote}>🎉 {t('checkout.freeDelivery')}</Text>
        ) : null}
      </View>

      {/* ── Cancellation policy ──────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.cancelHeader}>
          <Ionicons name="shield-checkmark-outline" size={20} color={Colors.textSecondary} />
          <Text style={styles.cardTitle}>{t('checkout.cancellationTitle')}</Text>
        </View>
        <Text style={styles.cancelBody}>{t('checkout.cancellationBody')}</Text>
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
        // Variant-aware: a product can have two lines (e.g. 500ml + 1L), so the
        // bare productId is not unique. Mirrors cartKey() from CartContext.
        keyExtractor={(item) => (item.variantId ? `${item.productId}::${item.variantId}` : item.productId)}
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

      {/* ── Sticky bottom: Delivering-to + full-width Place Order ─────────── */}
      <View style={[styles.stickyBottom, { paddingBottom: Spacing.md + insets.bottom }]}>
        {/* Delivering-to summary */}
        <TouchableOpacity
          style={styles.deliverRow}
          activeOpacity={0.8}
          onPress={() => setShowAddressForm(true)}
        >
          <View style={styles.deliverHomeCircle}>
            <Ionicons name="location" size={18} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            {selectedAddr ? (
              <>
                <Text style={styles.deliverLabel} numberOfLines={1}>
                  {t('checkout.deliveringTo')}{' '}
                  <Text style={styles.deliverBold}>{authState.name ?? labelDisplay(selectedAddr.label, t)}</Text>
                </Text>
                <Text style={styles.deliverSub} numberOfLines={1}>{selectedAddr.street}, {selectedAddr.locality}</Text>
              </>
            ) : (
              <Text style={styles.deliverLabel} numberOfLines={1}>{t('address.selectAddress')}</Text>
            )}
          </View>
          <View style={styles.changePill}>
            <Text style={styles.changePillText}>{t('checkout.change')}</Text>
          </View>
        </TouchableOpacity>

        <View style={styles.stickyDivider} />

        {/* Pay-method caption + closed notice */}
        {!withinHours ? (
          <Text style={styles.closedNotice}>{t('checkout.closedNotice')}</Text>
        ) : (
          <View style={styles.payCaptionRow}>
            <Ionicons
              name={paymentMethod === PaymentMethod.COD ? 'cash-outline' : 'flash-outline'}
              size={14}
              color={Colors.textSecondary}
            />
            <Text style={styles.payCaption}>
              {t('checkout.payUsing')}{' '}
              <Text style={styles.payCaptionBold}>
                {paymentMethod === PaymentMethod.COD ? t('checkout.cod') : t('checkout.payOnline')}
              </Text>
            </Text>
          </View>
        )}

        {/* Place Order — full width */}
        <Animated.View style={{ transform: [{ scale: placeBtnScale }] }}>
          <TouchableOpacity style={[styles.placeOrderBtn, !canPlaceOrder && styles.placeBtnDisabled]} onPress={pulseAndPlace} disabled={!canPlaceOrder} activeOpacity={0.9}>
            {placing ? <LoadingDots /> : (
              <>
                <View>
                  <Text style={styles.placeTotalRs}>₹{totalRupees}</Text>
                  <Text style={styles.placeTotalLabel}>{t('cart.total')}</Text>
                </View>
                <View style={styles.placeCta}>
                  <Text style={styles.placeOrderBtnText}>{t('checkout.placeOrder')}</Text>
                  <Ionicons name="arrow-forward" size={18} color={Colors.white} />
                </View>
              </>
            )}
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* ── Razorpay checkout (online payment) ───────────────────────────── */}
      {rzpData && (
        <React.Suspense
          fallback={
            <View style={styles.verifyOverlay}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          }
        >
          <RazorpayCheckout
            visible
            keyId={rzpData.keyId}
            razorpayOrderId={rzpData.razorpayOrderId}
            amountPaise={rzpData.amountPaise}
            merchantName="Bringly"
            description={t('checkout.title')}
            themeColor={Colors.primary}
            prefill={{
              name:    authState.name ?? undefined,
              contact: authState.phone ?? undefined,
            }}
            onSuccess={handlePaymentSuccess}
            onDismiss={handlePaymentDismiss}
            onError={handlePaymentError}
          />
        </React.Suspense>
      )}

      {/* Verifying payment with the server */}
      {verifying && (
        <View style={styles.verifyOverlay}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.verifyText}>{t('checkout.verifying')}</Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background, gap: Spacing.md },
  loadingText: { fontSize: FontSize.md, color: Colors.textLight },
  listContent: { paddingBottom: 0 },

  section: {
    backgroundColor: Colors.card, marginHorizontal: Spacing.lg, marginTop: Spacing.md,
    borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.04)', ...Shadow.md,
  },
  sectionNoBottomPad: { paddingBottom: Spacing.md },
  sectionNoTopPad: { marginTop: Spacing.md },
  cardTitle: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },
  sectionSub: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '700', marginTop: 2 },

  // Order-for bar
  orderForCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  orderForIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  orderForText: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary },
  orderForName: { fontWeight: '800', color: Colors.textPrimary },
  orderForChange: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.primary },

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
  addressCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg,
    paddingVertical: 14, paddingHorizontal: 14, paddingLeft: 16,
    backgroundColor: Colors.surface, overflow: 'hidden', ...Shadow.xs,
  },
  addressCardSelected: { borderWidth: 1.5, borderColor: Colors.primary, backgroundColor: Colors.primaryLight, ...Shadow.sm },
  // Left accent bar revealed on the selected card.
  addrAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: Colors.primary },

  addrTypeTile: {
    width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  addrTypeTileOn: { backgroundColor: Colors.white },
  addrTypeEmoji: { fontSize: 20 },

  addressCardLeft: { flex: 1, gap: 2 },
  addrLabelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: 1 },
  addressLabel: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.textPrimary, flexShrink: 1 },
  defaultPill: { backgroundColor: Colors.successLight, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  defaultPillText: { fontSize: 10, color: Colors.success, fontWeight: FontWeight.bold, letterSpacing: 0.3 },
  addressStreet: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  addressArea: { fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 16 },

  addrRadio: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  addrRadioOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },

  addAddressBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.primaryLight, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: 'rgba(255,107,53,0.18)',
    paddingVertical: 12, paddingHorizontal: 14, marginTop: 2,
  },
  addPlusCircle: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.white,
    alignItems: 'center', justifyContent: 'center', ...Shadow.xs,
  },
  addAddressBtnText: { flex: 1, color: Colors.primary, fontWeight: FontWeight.bold, fontSize: FontSize.md },

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
  totalRow: {
    borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.md, marginTop: Spacing.sm,
  },
  totalLabel: { fontSize: FontSize.xl, fontWeight: '900', color: Colors.text, letterSpacing: -0.3 },
  totalValue: { fontSize: FontSize.xxl, fontWeight: '900', color: Colors.primary, letterSpacing: -0.5 },

  // Bill details
  billRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.sm },
  billLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  billLabel: { fontSize: FontSize.md, color: Colors.textSecondary },
  billValue: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  billFree: { fontSize: FontSize.md, fontWeight: '900', color: Colors.success, letterSpacing: 0.3 },
  billNudge: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '700', marginTop: 4, marginLeft: 24 },
  billDivider: { height: 1, backgroundColor: Colors.border, marginTop: Spacing.md },
  billTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.md },
  billTotalLabel: { fontSize: FontSize.lg, fontWeight: '900', color: Colors.textPrimary, letterSpacing: -0.3 },
  billTotalValue: { fontSize: FontSize.xl, fontWeight: '900', color: Colors.textPrimary, letterSpacing: -0.3 },

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
    borderTopLeftRadius: Radius.xxl, borderTopRightRadius: Radius.xxl,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, gap: Spacing.sm,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.14, shadowRadius: 18, elevation: 16,
  },

  // Delivering-to summary (redesigned bottom bar)
  deliverRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  deliverHomeCircle: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  deliverLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  deliverBold: { fontWeight: '900', color: Colors.textPrimary },
  deliverSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },
  changePill: {
    backgroundColor: Colors.primaryLight, borderRadius: Radius.full,
    paddingHorizontal: Spacing.md, paddingVertical: 6,
  },
  changePillText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '800' },
  stickyDivider: { height: 1, backgroundColor: Colors.divider, marginTop: 2 },
  payCaptionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  payCaption: { fontSize: FontSize.xs, color: Colors.textSecondary },
  payCaptionBold: { fontWeight: '800', color: Colors.textPrimary },
  closedNotice: { fontSize: FontSize.sm, color: Colors.error, fontWeight: '700' },

  payRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  payUsing: { width: 96 },
  payUsingLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '700', letterSpacing: 0.5 },
  payUsingValue: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '700', marginTop: 1 },
  placeOrderBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.primary, borderRadius: Radius.xl, height: 60, paddingHorizontal: Spacing.lg, ...Shadow.primary,
  },
  placeBtnDisabled: { opacity: 0.5 },
  placeTotalRs: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '900', lineHeight: 20 },
  placeTotalLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  placeCta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  placeOrderBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '900' },

  dotsRow: { flexDirection: 'row', gap: 6, alignSelf: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.white },

  // Payment method selector
  payOption: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.lg, paddingHorizontal: Spacing.md,
    borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.surface, marginTop: Spacing.md,
  },
  payOptionSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight, ...Shadow.xs },
  payOptionTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  payOptionHint:  { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 1 },
  payRadio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.border,
    justifyContent: 'center', alignItems: 'center',
  },
  payRadioSelected: { borderColor: Colors.primary },
  payRadioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: Colors.primary },

  // Promo code (Chunk 7.3)
  promoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  promoInput: {
    flex: 1, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, height: 48, fontSize: FontSize.md,
    color: Colors.text, backgroundColor: Colors.surface, letterSpacing: 1,
  },
  promoApplyBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md, height: 48,
    paddingHorizontal: Spacing.lg, alignItems: 'center', justifyContent: 'center', minWidth: 88,
  },
  promoApplyText: { color: Colors.white, fontWeight: '800', fontSize: FontSize.md },
  promoAppliedRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.successLight, borderRadius: Radius.md, padding: Spacing.md,
  },
  promoAppliedText: { flex: 1, color: Colors.success, fontWeight: '800', fontSize: FontSize.md },
  promoRemove: { color: Colors.error, fontWeight: '800', fontSize: FontSize.sm },
  promoHint: { fontSize: FontSize.sm, color: Colors.textMuted, fontStyle: 'italic' },
  promoError: { fontSize: FontSize.sm, color: Colors.error, fontWeight: '700' },
  promoAutoNote: { fontSize: FontSize.sm, color: Colors.success, fontWeight: '800' },

  // Phase B — "you might also like". Lives at the page margin (16px sides, no
  // card padding) so the 3-up compact-card math lines up exactly — same as the
  // Order Again grid. Inside a padded section the third card would wrap off.
  alsoSection: { marginHorizontal: Spacing.lg, marginTop: Spacing.md, gap: Spacing.md },
  alsoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },

  // Delivery instructions (multi-select)
  instrRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  instrCard: {
    flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0,
    alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.xs,
    borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.surface, minHeight: 78,
  },
  instrCardOn: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight, ...Shadow.xs },
  instrCheck: {
    position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', zIndex: 2,
  },
  instrIconCircle: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  instrIconCircleOn: { backgroundColor: Colors.white },
  instrLabel: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, textAlign: 'center', lineHeight: 14 },
  instrLabelOn: { color: Colors.primary },

  // Tip your delivery partner — gradient banner + white body
  tipSection: {
    marginHorizontal: Spacing.lg, marginTop: Spacing.md, borderRadius: Radius.xl,
    overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(0,0,0,0.04)', ...Shadow.md,
  },
  tipBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.lg },
  tipTitle: { fontSize: FontSize.lg, fontWeight: '900', color: Colors.white, letterSpacing: -0.3 },
  tipSub: { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.92)', marginTop: 3, lineHeight: 16 },
  tipScooter: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  tipBody: { backgroundColor: Colors.surface, padding: Spacing.lg, gap: Spacing.md },
  tipChips: { flexDirection: 'row', gap: Spacing.sm },
  tipChip: {
    // Explicit flex basis + minWidth:0 so all four chips shrink to share one row
    // (RN flex items default to min-width:auto and otherwise refuse to shrink).
    flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0,
    alignItems: 'center', justifyContent: 'center', gap: 2, height: 60,
    borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  tipChipOn: { borderColor: Colors.primary, backgroundColor: Colors.primary, ...Shadow.xs },
  tipEmoji: { fontSize: 17, lineHeight: 21 },
  tipChipText: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.text },
  tipChipTextOn: { color: Colors.white },
  tipCustomRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.background,
    borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.primary, paddingHorizontal: Spacing.md, height: 50,
  },
  tipCustomRupee: { fontSize: FontSize.lg, fontWeight: '900', color: Colors.text },
  tipCustomInput: { flex: 1, fontSize: FontSize.md, color: Colors.text, height: 50, fontWeight: '700' },
  tipThanksRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tipThanks: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.success },

  // Cancellation policy
  cancelHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cancelBody: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },

  // Verifying-payment overlay
  verifyOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', gap: Spacing.md,
  },
  verifyText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },
});
