import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type {
  AddressResponse,
  CartItem,
  CartResponse,
  PricingPreviewResponse,
} from '@chirawa/types';
import { PaymentMethod } from '@chirawa/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { FontSize, FontWeight, MIN_TAP, Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { isOpenNow } from '../../utils/operatingHours';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { type RazorpaySuccess } from '../../components/payment/RazorpayCheckout';
import ProductCard, { type ProductCardData } from '../../components/product/ProductCard';
import BrandedLoader from '../../components/BrandedLoader';
import { useToast } from '../../components/ui';
import { FEATURES } from '../../config/features';
import LocationSheet from '../../components/location/LocationSheet';
import { useAddresses } from '../../context/AddressContext';
import { fetchProducts, toProductCard } from '../../services/catalog';

// Lazy-loaded so `react-native-webview` (a native module) is only required when
// the Razorpay sheet actually opens. Keeps the app bootable on a dev client that
// predates the webview native module — only online payment needs the rebuild.
const RazorpayCheckout = React.lazy(() => import('../../components/payment/RazorpayCheckout'));

// Addresses store their label as a Hindi string ('घर'); show it in the active
// language (the sticky "Delivering to" line falls back to it when there's no name).
function labelDisplay(label: string | null | undefined, t: (k: string) => string): string {
  if (label === 'घर')   return t('address.typeHome');
  if (label === 'दुकान') return t('address.typeWork');
  if (label === 'अन्य')  return t('address.typeOther');
  return label ?? t('address.typeOther');
}

type Props = NativeStackScreenProps<RootStackParamList, 'Checkout'>;

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
  item, color, onQty, busy, showDivider,
}: { item: CartItem; color: string; onQty: (qty: number) => void; busy: boolean; showDivider: boolean }) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  return (
    <View style={[styles.itemRow, showDivider && styles.itemRowDivider]}>
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
export default function CheckoutScreen({ navigation, route }: Props) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const { state: authState } = useAuth();
  // Shared cart subtotal — the "You might also like" rail adds through this same
  // context, so it's our signal that an item was added outside the items list.
  // pendingMutations / flushPendingMutations gate + serialize checkout against
  // in-flight cart writes (YMAL race fix, Phase 1).
  const { subtotalPaise: cartCtxSubtotal, pendingMutations, flushPendingMutations, setQuantity } = useCart();

  const [cart, setCart]               = useState<CartResponse | null>(null);
  const [cartLoading, setCartLoading] = useState(true);

  const [addressId,  setAddressId]  = useState<string | null>(null);

  // Active delivery address from the global context — switching it (here or
  // anywhere) re-prices this order.
  const { current, addresses: ctxAddresses, loading: addressesLoading, select } = useAddresses();
  // Address picker sheet (ss/1.jpeg) + an optional "Someone else" receiver carried
  // back from the add-address page, applied to the order after it's placed.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [receiver,  setReceiver]  = useState<{ name: string; phone: string } | null>(null);

  const [pricing, setPricing] = useState<PricingPreviewResponse | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Promo code (A3): `appliedCode` is the user-typed code the bill is priced
  // with (the auto FIRSTORDER promo needs none). State drives the UI; the ref
  // feeds refreshPricing so every re-price path carries the code without
  // recreating the callback chain on apply/remove.
  const [promoInput, setPromoInput]         = useState('');
  const [appliedCode, setAppliedCodeState] = useState<string | null>(null);
  const [promoApplying, setPromoApplying]   = useState(false);
  const appliedCodeRef = useRef<string | null>(null);
  const setAppliedCode = useCallback((code: string | null) => {
    appliedCodeRef.current = code;
    setAppliedCodeState(code);
  }, []);

  // Pricing-preview transport state (A3): failures are no longer silent — the
  // bill shows a retry row and Place Order stays gated until pricing exists.
  const [pricingError, setPricingError] = useState(false);
  const [repricing, setRepricing]       = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.COD);
  const [placing,       setPlacing]       = useState(false);
  const toast = useToast();

  // Razorpay checkout (online payment). Non-null = the sheet is open for this order.
  const [rzpData, setRzpData] = useState<{
    orderId: string; keyId: string; razorpayOrderId: string; amountPaise: number;
    // Savings + multi-shop breakdown carried through payment for OrderPlaced.
    savedPaise?: number;
    groupId?: string; shops?: Array<{ orderId: string; shopName: string; total: number }>; totalAmount?: number;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);

  // "You might also like" rail.
  const [alsoLike, setAlsoLike] = useState<ProductCardData[]>([]);

  useEffect(() => {
    let active = true;
    fetchProducts({ limit: 6 })
      .then((p) => { if (active) setAlsoLike(p.map(toProductCard)); })
      .catch(() => { /* tolerate — section hides */ });
    return () => { active = false; };
  }, []);

  const placeBtnScale = useRef(new Animated.Value(1)).current;
  // Synchronous re-entrancy lock for Place Order. A ref (not state) so a second tap
  // during the pulse animation — before `placing` re-renders — is a no-op. Server-side
  // idempotency is the real guarantee; this just stops the duplicate request at source.
  const submittingRef = useRef(false);

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

  // Single pricing-preview entry point — carries the applied promo code (via
  // the ref, so every re-price path includes it) and owns the loading/error
  // flags. Returns the response so callers can react to promoError.
  const refreshPricing = useCallback(
    async (cartId: string, addrId: string): Promise<PricingPreviewResponse | null> => {
      setRepricing(true);
      try {
        const data = await api.getPricingPreview({
          cartId,
          addressId: addrId,
          ...(appliedCodeRef.current ? { promoCode: appliedCodeRef.current } : {}),
        });
        setPricing(data);
        setPricingError(false);
        return data;
      } catch {
        // Keep any previous bill; surface the failure so the retry row shows
        // and Place Order stays gated on !!pricing.
        setPricingError(true);
        return null;
      } finally {
        setRepricing(false);
      }
    },
    [],
  );

  const handleSelectSavedAddress = useCallback(async (addr: AddressResponse) => {
    setAddressId(addr.id);
    if (!cart) return;
    await refreshPricing(cart.cartId, addr.id);
  }, [cart, refreshPricing]);

  // Sync the active address from the global context, and re-price on every switch
  // (or when the cart finishes loading).
  useEffect(() => {
    if (current) void handleSelectSavedAddress(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, cart?.cartId]);

  useEffect(() => {
    if (!cart || !addressId || pricing) return;
    void refreshPricing(cart.cartId, addressId);
  }, [cart, addressId, pricing, refreshPricing]);

  // Returning from the add-address page (ss/2.jpeg): select the new address and
  // remember a "Someone else" receiver, then clear the params so it fires once.
  useEffect(() => {
    const p = route.params;
    if (!p?.newAddressId && !p?.receiverName) return;
    if (p.receiverName && p.receiverPhone) setReceiver({ name: p.receiverName, phone: p.receiverPhone });
    // A freshly-added address → make it the active one (context syncs + re-prices).
    if (p.newAddressId) void select(p.newAddressId);
    navigation.setParams({ newAddressId: undefined, receiverName: undefined, receiverPhone: undefined });
  }, [route.params, navigation, select]);

  // Reload cart (+ pricing) after an in-checkout quantity change.
  const reloadCart = useCallback(async (addrId: string | null) => {
    const data = await api.getCart();
    if (!data || data.items.length === 0) {
      Alert.alert(t('cart.empty'), t('cart.emptyHint'), [{ text: t('common.back'), onPress: () => navigation.goBack() }]);
      return;
    }
    setCart(data);
    if (addrId) {
      await refreshPricing(data.cartId, addrId);
    }
  }, [navigation, t, refreshPricing]);

  // Keep the bill in sync with cart writes that don't update this screen's local
  // `cart`/`pricing` directly. The "You might also like" rail AND the in-list qty
  // steppers both mutate through the shared CartContext now (so every write is
  // tracked in pendingMutations), so we re-pull the bill whenever the context
  // subtotal moves. reloadCart itself doesn't touch the context, so it can't loop this.
  const lastCtxSubtotalRef = useRef<number | null>(null);
  useEffect(() => {
    if (!cart) return;                                  // wait until the cart loads
    if (lastCtxSubtotalRef.current === null) {
      lastCtxSubtotalRef.current = cartCtxSubtotal;     // adopt baseline, don't reload
      return;
    }
    if (cartCtxSubtotal === lastCtxSubtotalRef.current) return;
    lastCtxSubtotalRef.current = cartCtxSubtotal;
    void reloadCart(addressId);
  }, [cartCtxSubtotal, cart, addressId, reloadCart]);

  const changeQty = useCallback(async (productId: string, qty: number) => {
    setUpdatingId(productId);
    try {
      // Route the in-list stepper through the TRACKED CartContext mutation — no
      // direct cart-write API call here — so the write registers in pendingMutations
      // (gating Place Order and awaited by flushPendingMutations), exactly like a
      // YMAL add. CartContext surfaces its own errors (toast) + reverts; the
      // cartCtxSubtotal watcher re-pulls this screen's bill once the subtotal moves.
      await setQuantity(productId, Math.max(0, qty));
    } finally {
      setUpdatingId(null);
    }
  }, [setQuantity]);

  // ── Promo apply / remove (A3) ───────────────────────────────────────────
  const applyPromo = useCallback(async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code || !cart || !addressId || promoApplying) return;
    setPromoApplying(true);
    setAppliedCode(code);
    const result = await refreshPricing(cart.cartId, addressId);
    // Rejected (or transport failure): drop the code so later re-prices don't
    // resend it. result.promoError stays on screen via the pricing state.
    if (!result || result.promoError) setAppliedCode(null);
    setPromoApplying(false);
  }, [promoInput, cart, addressId, promoApplying, refreshPricing, setAppliedCode]);

  const removePromo = useCallback(async () => {
    if (!cart || !addressId) return;
    setAppliedCode(null);
    setPromoInput('');
    await refreshPricing(cart.cartId, addressId); // the auto promo may return
  }, [cart, addressId, refreshPricing, setAppliedCode]);

  const pulseAndPlace = () => {
    // Claim the submit synchronously BEFORE the animation starts; a rapid second
    // tap returns here instead of queuing a second handlePlaceOrder.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setPlacing(true);
    Animated.sequence([
      Animated.spring(placeBtnScale, { toValue: 0.95, friction: 5, tension: 300, useNativeDriver: true }),
      Animated.spring(placeBtnScale, { toValue: 1.05, friction: 5, tension: 300, useNativeDriver: true }),
      Animated.spring(placeBtnScale, { toValue: 1, friction: 5, tension: 300, useNativeDriver: true }),
    ]).start(() => { void handlePlaceOrder(); });
  };

  const handlePlaceOrder = useCallback(async () => {
    if (!cart || !addressId) { submittingRef.current = false; setPlacing(false); return; }

    setPlacing(true);
    try {
      // Ensure every in-flight cart write (e.g. a YMAL add tapped a moment ago)
      // has committed server-side BEFORE we create the order — otherwise
      // placeOrder consumes a pre-add cart and the item is lost.
      await flushPendingMutations();

      const result = await api.placeOrder({
        cartId: cart.cartId, addressId, paymentMethod,
        // Only a user-typed code travels; the auto FIRSTORDER promo is
        // re-resolved server-side at creation (same rules as the preview).
        ...(appliedCodeRef.current ? { promoCode: appliedCodeRef.current } : {}),
      });

      // "You saved ₹X" recap on the success screen — from the previewed bill.
      const savedPaise = pricing && pricing.discount > 0 ? pricing.discount : 0;

      // "Someone else" receiver (from the add-address page) → attach to the order.
      // Best-effort: a failure here must never block a placed order.
      if (receiver) {
        try { await api.updateOrderReceiver(result.orderId, receiver.name, receiver.phone); } catch { /* tolerate */ }
      }

      // Per-shop breakdown for the order-placed + group-tracking screens. Only
      // present (and only >1) when the cart spanned multiple shops.
      const groupExtras = result.groupId && result.shops && result.shops.length > 1
        ? {
            groupId:     result.groupId,
            shops:       result.shops.map((s) => ({ orderId: s.orderId, shopName: s.shopName, total: s.total })),
            totalAmount: result.totalAmount,
          }
        : null;

      if (paymentMethod === PaymentMethod.COD) {
        navigation.replace('OrderPlaced', {
          orderId: result.orderId,
          ...(savedPaise > 0 ? { savedPaise } : {}),
          ...(groupExtras ?? {}),
        });
        return;
      }

      // Online payment → open Razorpay checkout for the just-created order.
      if (result.razorpayOrderId && result.razorpayKeyId) {
        setRzpData({
          orderId:         result.orderId,
          keyId:           result.razorpayKeyId,
          razorpayOrderId: result.razorpayOrderId,
          amountPaise:     result.amountPaise ?? result.totalAmount,
          ...(savedPaise > 0 ? { savedPaise } : {}),
          ...(groupExtras ?? {}),
        });
      } else {
        Alert.alert(t('common.error'), t('checkout.paymentInitFailed'));
      }
    } catch (err: unknown) {
      // A typed code can die between preview and placement (expired / used up /
      // limit hit). Re-price to reconcile the bill: if the code now soft-fails,
      // drop it — the promo section surfaces promoError with the reason.
      if (appliedCodeRef.current && cart && addressId) {
        const p = await refreshPricing(cart.cartId, addressId);
        if (p?.promoError) setAppliedCode(null);
      }
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('common.error'));
    } finally {
      setPlacing(false);
      submittingRef.current = false;
    }
  }, [cart, addressId, paymentMethod, receiver, pricing, navigation, t, flushPendingMutations, refreshPricing, setAppliedCode]);

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
      navigation.replace('OrderPlaced', {
        orderId: data.orderId,
        ...(data.savedPaise ? { savedPaise: data.savedPaise } : {}),
        ...(data.groupId && data.shops ? { groupId: data.groupId, shops: data.shops, totalAmount: data.totalAmount } : {}),
      });
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
  const totalRupees    = pricing ? Math.round(pricing.total / 100) : subtotalRupees;
  const itemCount      = cart ? cart.items.reduce((s, i) => s + i.quantity, 0) : 0;
  const nudge          = cart ? deliveryNudge(cart.subtotal, t) : null;
  const selectedAddr   = ctxAddresses.find((a) => a.id === addressId) ?? null;
  const discountRupees = pricing ? Math.round(pricing.discount / 100) : 0;
  // The discount already covers the delivery fee → "reduce your fee" nudges
  // would contradict the bill; suppress them.
  const feeFree = !!pricing && pricing.discount > 0 && pricing.discount >= pricing.deliveryFee;

  const withinHours   = isOpenNow();
  // Block checkout while a cart write is still in flight (e.g. a just-tapped YMAL
  // add) so Place Order can't consume a pre-add cart. handlePlaceOrder also awaits
  // flushPendingMutations as a belt-and-suspenders for the sub-tap-timing window.
  // A3: also require a loaded, settled pricing preview — the button total and
  // the charged total must never diverge (previously a failed preview still
  // allowed placement with a subtotal-only total on the button).
  const canPlaceOrder = !!addressId && !placing && !!cart && withinHours && pendingMutations === 0
    && !!pricing && !repricing;

  const ListHeader = (
    <>
      {/* ── Order for {name}, {phone} — one consistent bold line ─────────── */}
      <View style={[styles.section, styles.orderForCard]}>
        <View style={styles.orderForIcon}>
          <Ionicons name="person" size={18} color={Colors.primary} />
        </View>
        <Text style={styles.orderForText} numberOfLines={1}>
          {t('checkout.orderFor')} {authState.name ?? 'You'}{authState.phone ? `, ${authState.phone}` : ''}
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
      {nudge && !feeFree && (
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

      {/* ── Delivery in 20 minutes — top of the unified items card ───────── */}
      <View style={styles.deliveryHeaderCard}>
        <View style={styles.deliveryHeader}>
          <View style={styles.clockBadge}>
            <Ionicons name="time" size={22} color={Colors.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{t('checkout.deliveryIn20Mins')}</Text>
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
      {/* Rounded bottom cap that closes the unified delivery + items card */}
      <View style={styles.itemsCap} />

      {/* ── You might also like ──────────────────────────────────────────── */}
      {alsoLike.length > 0 && (
        <View style={styles.alsoSection}>
          <Text style={styles.cardTitle}>{t('product.frequentlyBought')}</Text>
          <View style={styles.alsoGrid}>
            {alsoLike.map((p) => <ProductCard key={p.productId} product={p} size="compact" />)}
          </View>
        </View>
      )}

      {/* ── Promo code (A3) ──────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.cardTitle}>{t('checkout.promoTitle')}</Text>

        {pricing?.appliedPromoCode ? (
          appliedCode ? (
            // User-typed code — show the win + a Remove affordance.
            <View style={styles.promoAppliedRow}>
              <Ionicons name="pricetag" size={18} color={Colors.success} />
              <Text style={styles.promoAppliedText}>
                {pricing.appliedPromoCode} {t('checkout.promoApplied')} · −₹{discountRupees}
              </Text>
              <TouchableOpacity
                onPress={() => void removePromo()}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={t('checkout.promoRemove')}
              >
                <Text style={styles.promoRemove}>{t('checkout.promoRemove')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // Auto-applied FIRSTORDER — celebrate it; nothing to remove.
            <View style={styles.promoAppliedRow}>
              <Ionicons name="gift" size={18} color={Colors.success} />
              <Text style={styles.promoAppliedText}>{t('checkout.firstOrderApplied')}</Text>
            </View>
          )
        ) : (
          <>
            <View style={styles.promoRow}>
              <TextInput
                style={styles.promoInput}
                value={promoInput}
                onChangeText={(v) => setPromoInput(v.replace(/\s/g, '').toUpperCase())}
                placeholder={t('checkout.promoPlaceholder')}
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={30}
                editable={!promoApplying}
                accessibilityLabel={t('checkout.promoTitle')}
              />
              <TouchableOpacity
                style={[styles.promoApplyBtn, (!promoInput.trim() || promoApplying) && styles.placeBtnDisabled]}
                onPress={() => void applyPromo()}
                disabled={!promoInput.trim() || promoApplying}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('checkout.apply')}
                accessibilityState={{ disabled: !promoInput.trim() || promoApplying, busy: promoApplying }}
              >
                {promoApplying
                  ? <ActivityIndicator color={Colors.white} size="small" />
                  : <Text style={styles.promoApplyText}>{t('checkout.apply')}</Text>}
              </TouchableOpacity>
            </View>
            {/* Server's soft-fail reason (expired / min-cart / used up) */}
            {pricing?.promoError ? (
              <Text style={styles.promoError} accessibilityLiveRegion="polite">
                {pricing.promoError}
              </Text>
            ) : null}
          </>
        )}
      </View>

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
        {/* Server's fee explanation (Hindi) — why the fee is what it is */}
        {pricing?.breakdownText ? <Text style={styles.billBreakdown}>{pricing.breakdownText}</Text> : null}
        {nudge && !nudge.done && !feeFree && <Text style={styles.billNudge}>{nudge.text}</Text>}

        {/* Discount — the line that makes the total add up (A3) */}
        {pricing && pricing.discount > 0 && (
          <View style={styles.billRow}>
            <View style={styles.billLabelWrap}>
              <Ionicons name="pricetag-outline" size={16} color={Colors.success} />
              <Text style={styles.billDiscountLabel}>
                {t('checkout.discount')}{pricing.appliedPromoCode ? ` (${pricing.appliedPromoCode})` : ''}
              </Text>
            </View>
            <Text style={styles.billDiscountValue}>−₹{discountRupees}</Text>
          </View>
        )}

        {/* Preview failed — Place Order stays disabled until this resolves */}
        {pricingError && !pricing && (
          <TouchableOpacity
            style={styles.billErrorRow}
            onPress={() => { if (cart && addressId) void refreshPricing(cart.cartId, addressId); }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${t('checkout.pricingFailed')} — ${t('tracking.retry')}`}
          >
            <Ionicons name="alert-circle-outline" size={16} color={Colors.error} />
            <Text style={styles.billErrorText}>{t('checkout.pricingFailed')} · {t('tracking.retry')}</Text>
          </TouchableOpacity>
        )}

        <View style={styles.billDivider} />
        <View style={styles.billTotalRow}>
          <Text style={styles.billTotalLabel}>{t('checkout.grandTotal')}</Text>
          <View style={styles.billTotalWrap}>
            {repricing && <ActivityIndicator size="small" color={Colors.primary} />}
            <Text style={styles.billTotalValue}>₹{totalRupees}</Text>
          </View>
        </View>
        {pricing && pricing.discount > 0 && (
          <View style={styles.savedStrip}>
            <Text style={styles.savedStripText}>
              {t('cart.saved')}{discountRupees}{t('cart.savedSuffix')} 🎉
            </Text>
          </View>
        )}
      </View>

      {/* ── Payment Method ───────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.cardTitle}>{t('checkout.paymentMethod')}</Text>
        {([
          // COD-only launch (Phase 5): "Pay Online" stays VISIBLE as a coming-soon
          // option (hiding it would look broken) but can't be selected — a tap
          // explains via toast. The API rejects non-COD orders regardless.
          { method: PaymentMethod.COD, icon: 'cash-outline',  title: t('checkout.cod'),       hint: t('checkout.codHint'),    comingSoon: false },
          { method: PaymentMethod.UPI, icon: 'card-outline',  title: t('checkout.payOnline'), hint: t('checkout.onlineHint'), comingSoon: !FEATURES.onlinePayments },
        ] as const).map((opt) => {
          const selected = paymentMethod === opt.method;
          return (
            <TouchableOpacity
              key={opt.method}
              style={[styles.payOption, selected && styles.payOptionSelected, opt.comingSoon && styles.payOptionComingSoon]}
              onPress={() => {
                if (opt.comingSoon) { toast.show(t('checkout.comingSoon'), 'info'); return; }
                setPaymentMethod(opt.method);
              }}
              activeOpacity={0.8}
            >
              <Ionicons name={opt.icon} size={22} color={selected ? Colors.primary : Colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.payOptionTitle}>{opt.title}</Text>
                <Text style={styles.payOptionHint}>{opt.hint}</Text>
              </View>
              {opt.comingSoon ? (
                <View style={styles.comingSoonBadge}>
                  <Text style={styles.comingSoonBadgeText}>{t('common.comingSoon')}</Text>
                </View>
              ) : (
                <View style={[styles.payRadio, selected && styles.payRadioSelected]}>
                  {selected && <View style={styles.payRadioDot} />}
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Cancellation policy ──────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.cancelHeader}>
          <Ionicons name="shield-checkmark-outline" size={20} color={Colors.textSecondary} />
          <Text style={styles.cardTitle}>{t('checkout.cancellationTitle')}</Text>
        </View>
        <Text style={styles.cancelBody}>{t('checkout.cancellationBody')}</Text>
      </View>

      <View style={[styles.bottomSpacer, { height: 168 + insets.bottom }]} />
    </>
  );

  if (cartLoading) {
    return <BrandedLoader message={t('common.loading')} />;
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
            showDivider={index > 0}
          />
        )}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        style={styles.flex}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      />

      {/* ── Sticky bottom: Delivering-to + full-width Place Order ─────────── */}
      <View style={[styles.stickyBottom, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
        {/* Delivering-to summary — tap to open the address picker (ss/1.jpeg) */}
        <TouchableOpacity
          style={styles.deliverRow}
          activeOpacity={0.8}
          onPress={() => setSheetOpen(true)}
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

      {/* ── Address picker (ss/1.jpeg) — Add new + WhatsApp + saved ──────── */}
      <LocationSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        userName={authState.name}
        userPhone={authState.phone}
        compact
      />

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
  // One consistent bold line: "Order for {name}, {phone}".
  orderForText: { flex: 1, fontSize: FontSize.md, fontWeight: '800', color: Colors.textPrimary },
  orderForChange: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.primary },

  // Savings nudge
  nudgeBox: { backgroundColor: Colors.primaryLight, borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.sm },
  nudgeBoxDone: { backgroundColor: Colors.successLight },
  nudgeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  nudgeText: { flex: 1, fontSize: FontSize.sm, color: Colors.text, fontWeight: '700' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.08)', overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: Colors.primary },

  // Delivery header — top of the unified "delivery + items" card. Rounded top,
  // open bottom (the item rows continue the card; itemsCap closes it).
  deliveryHeaderCard: {
    marginHorizontal: Spacing.lg, marginTop: Spacing.md,
    backgroundColor: Colors.card,
    borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    borderWidth: 1, borderBottomWidth: 0, borderColor: 'rgba(0,0,0,0.04)',
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing.md,
  },
  deliveryHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  // Filled clock badge — premium look (white clock on a primary disc).
  clockBadge: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center', ...Shadow.primary,
  },
  deliverySub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },

  // Delivery item rows — middle of the unified card (side borders, no gaps).
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, marginHorizontal: Spacing.lg,
    borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(0,0,0,0.04)',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
  },
  itemRowDivider: { borderTopWidth: 1, borderTopColor: Colors.divider },
  // Rounded bottom cap that closes the card under the last item row.
  itemsCap: {
    marginHorizontal: Spacing.lg, height: Spacing.md, backgroundColor: Colors.card,
    borderBottomLeftRadius: Radius.xl, borderBottomRightRadius: Radius.xl,
    borderWidth: 1, borderTopWidth: 0, borderColor: 'rgba(0,0,0,0.04)',
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
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, gap: Spacing.sm,
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
  // COD-only launch: the online option is visible but dimmed, with a badge in
  // place of the radio (comingSoonBadge below) — deliberately not "broken grey".
  payOptionComingSoon: { opacity: 0.6 },
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

  // Bill transparency (A3): discount / savings / fee-explanation / error rows
  billBreakdown: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: -6 },
  billDiscountLabel: { fontSize: FontSize.md, color: Colors.success, fontWeight: '700' },
  billDiscountValue: { fontSize: FontSize.md, color: Colors.success, fontWeight: '800' },
  billErrorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  billErrorText: { fontSize: FontSize.sm, color: Colors.error, fontWeight: '700' },
  billTotalWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  savedStrip: {
    backgroundColor: Colors.successLight, borderRadius: Radius.md,
    paddingVertical: Spacing.sm, alignItems: 'center', marginTop: 2,
  },
  savedStripText: { color: Colors.success, fontWeight: '800', fontSize: FontSize.sm },

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
