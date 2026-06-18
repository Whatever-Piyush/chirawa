import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Linking,
  ActivityIndicator,
  Alert,
  Dimensions,
  Easing,
  Modal,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { io, type Socket } from 'socket.io-client';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { OrderDetailResponse, OrderItemResponse, AddressResponse } from '@chirawa/types';
import { OrderStatus } from '@chirawa/types';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { FontSize, FontWeight, Gradients, MIN_TAP, Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { api } from '../../services/api.service';
import { StorageService } from '../../services/storage.service';
import { useT } from '@chirawa/i18n';
import { useToast, FauxGradient } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { DEV_HOST } from '../../config/devHost';
import TrackingMap from '../../components/tracking/TrackingMap';
import BrandedLoader from '../../components/BrandedLoader';

const LOCATION_STALE_MS = 60_000; // rider location older than this → fallback message

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'OrderTracking'>;
  route:      RouteProp<RootStackParamList, 'OrderTracking'>;
};
const SOCKET_URL      = __DEV__ ? `http://${DEV_HOST}:3000` : 'https://api.chirawa.in';
const WHATSAPP_NUMBER = '916350076685';
const POLL_MS         = 15_000;

const STATUS_STEP: Partial<Record<OrderStatus, number>> = {
  [OrderStatus.PENDING_PAYMENT]:  0,
  [OrderStatus.PAID]:             0,
  [OrderStatus.CONFIRMED]:        0,
  [OrderStatus.PREPARING]:        1,
  [OrderStatus.READY_FOR_PICKUP]: 1,
  [OrderStatus.PICKED_UP]:        2,
  [OrderStatus.OUT_FOR_DELIVERY]: 2,
  [OrderStatus.DELIVERED]:        3,
};

const STEP_KEYS = [
  'tracking.confirmed',
  'tracking.preparing',
  'tracking.onTheWay',
  'tracking.delivered',
] as const;

const STATUS_EMOJI: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.PENDING_PAYMENT]:  '🎉',
  [OrderStatus.PAID]:             '🎉',
  [OrderStatus.CONFIRMED]:        '✅',
  [OrderStatus.PREPARING]:        '👨‍🍳',
  [OrderStatus.READY_FOR_PICKUP]: '📦',
  [OrderStatus.PICKED_UP]:        '🛵',
  [OrderStatus.OUT_FOR_DELIVERY]: '🛵',
  [OrderStatus.DELIVERED]:        '🎊',
  [OrderStatus.CANCELLED]:        '❌',
};

// ─── Compact order item row ───────────────────────────────────────────────────

function ItemRow({ item }: { item: OrderItemResponse }) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  return (
    <View style={styles.itemRow}>
      <Text style={styles.itemName} numberOfLines={1}>{item.productName}</Text>
      <Text style={styles.itemQty}>×{item.quantity}</Text>
      <Text style={styles.itemPrice}>₹{Math.round(item.subtotal / 100)}</Text>
    </View>
  );
}

// ─── Pulsing ring for active step ─────────────────────────────────────────────

function PulsingRing() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const scale   = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.parallel([
        Animated.timing(scale,   { toValue: 1.6, duration: 1500, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0,   duration: 1500, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [scale, opacity]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.pulseRing, { transform: [{ scale }], opacity }]}
    />
  );
}

// ─── Horizontal progress stepper ──────────────────────────────────────────────

function ProgressStepper({
  currentStep,
  t,
}: {
  currentStep: number;
  t: (key: string) => string;
}) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  return (
    <View style={styles.stepper}>
      {STEP_KEYS.map((key, i) => {
        const done   = i < currentStep;
        const active = i === currentStep;
        return (
          <React.Fragment key={key}>
            <View style={styles.stepCol}>
              {active ? (
                <View style={styles.stepDotWrap}>
                  <PulsingRing />
                  <View style={[styles.stepDot, styles.stepDotActive]}>
                    <Text style={[styles.stepDotText, styles.stepDotTextLight]}>{String(i + 1)}</Text>
                  </View>
                </View>
              ) : done ? (
                <View style={[styles.stepDot, styles.stepDotDone]}>
                  <Text style={[styles.stepDotText, styles.stepDotTextLight]}>✓</Text>
                </View>
              ) : (
                <View style={styles.stepDot}>
                  <Text style={styles.stepDotText}>{String(i + 1)}</Text>
                </View>
              )}
              <Text style={[
                styles.stepLabel,
                active && styles.stepLabelActive,
                done   && styles.stepLabelDone,
              ]}>
                {t(key)}
              </Text>
            </View>
            {i < STEP_KEYS.length - 1 && (
              <View style={[styles.stepLine, i < currentStep && styles.stepLineDone]} />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
}

// ─── Status emoji card (animated bounce-in) ───────────────────────────────────

function StatusEmojiCard({ emoji }: { emoji: string }) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const scale = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    scale.setValue(0);
    Animated.spring(scale, {
      toValue:         1,
      friction:        5,
      tension:         40,
      useNativeDriver: true,
    }).start();
  }, [emoji, scale]);
  return (
    <Animated.Text style={[styles.statusEmoji, { transform: [{ scale }] }]}>
      {emoji}
    </Animated.Text>
  );
}

// ─── Confetti particles for delivered state ───────────────────────────────────

const PARTICLES = ['⭐', '✨', '🎉', '⭐', '✨', '🎊'];
const SCREEN_WIDTH = Dimensions.get('window').width;

function Confetti() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const particles = useMemo(
    () => PARTICLES.map((p, i) => ({
      emoji: p,
      x:     (SCREEN_WIDTH / PARTICLES.length) * i + 12,
      delay: i * 180,
      anim:  new Animated.Value(0),
    })),
    [],
  );

  useEffect(() => {
    const anims = particles.map((p) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(p.delay),
          Animated.timing(p.anim, {
            toValue: 1,
            duration: 2400,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(p.anim, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [particles]);

  return (
    <View style={styles.confetti} pointerEvents="none">
      {particles.map((p, idx) => {
        const translateY = p.anim.interpolate({ inputRange: [0, 1], outputRange: [-30, 320] });
        const opacity    = p.anim.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 1, 1, 0] });
        const rotate     = p.anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
        return (
          <Animated.Text
            key={idx}
            style={[
              styles.confettiParticle,
              {
                left: p.x,
                transform: [{ translateY }, { rotate }],
                opacity,
              },
            ]}
          >
            {p.emoji}
          </Animated.Text>
        );
      })}
    </View>
  );
}

// ─── Delivered success banner ─────────────────────────────────────────────────

function DeliveredBanner({ t }: { t: (key: string) => string }) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const scale   = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale,   { toValue: 1, friction: 5, tension: 40, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration:   500, useNativeDriver: true }),
    ]).start();
  }, [scale, opacity]);

  return (
    <Animated.View style={[styles.deliveredBanner, { opacity }]}>
      <Confetti />
      <Animated.Text style={[styles.deliveredEmoji, { transform: [{ scale }] }]}>
        🎊
      </Animated.Text>
      <Text style={styles.deliveredTitle}>{t('tracking.orderDelivered')}</Text>
      <Text style={styles.deliveredSub}>{t('tracking.thankYou')}</Text>
    </Animated.View>
  );
}

// ─── Animated 5-star rater + comment + submit ─────────────────────────────────

function RatingCard({
  t,
  orderId,
  initialRating,
  initialComment,
  showToast,
}: {
  t: (key: string) => string;
  orderId: string;
  initialRating: number | null;
  initialComment: string | null;
  showToast: (msg: string, type: 'success' | 'error') => void;
}) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const [selectedRating, setSelectedRating] = useState(initialRating ?? 0);
  const [comment, setComment]               = useState(initialComment ?? '');
  const [submitting, setSubmitting]         = useState(false);
  const [rated, setRated]                   = useState(initialRating != null && initialRating > 0);

  // One animated scale per star — tapping animates 1 → 1.4 → 1
  const starScales = useRef([1, 2, 3, 4, 5].map(() => new Animated.Value(1))).current;

  function handleStarTap(starIndex: number) {
    if (submitting || rated) return;
    setSelectedRating(starIndex);
    Animated.sequence([
      Animated.spring(starScales[starIndex - 1], {
        toValue: 1.4, friction: 4, tension: 200, useNativeDriver: true,
      }),
      Animated.spring(starScales[starIndex - 1], {
        toValue: 1.0, friction: 4, tension: 200, useNativeDriver: true,
      }),
    ]).start();
  }

  async function handleSubmit() {
    if (selectedRating === 0 || submitting) return;
    setSubmitting(true);
    try {
      await api.rateOrder(orderId, selectedRating, comment.trim() || undefined);
      setRated(true);
      showToast(t('rating.thankYou'), 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message ? err.message : t('rating.error');
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (rated) {
    return (
      <View style={styles.ratingCard}>
        <Text style={styles.ratingThanksStars}>
          {'⭐'.repeat(Math.max(1, selectedRating))}
        </Text>
        <Text style={styles.ratingThanksText}>{t('rating.thankYou')}</Text>
      </View>
    );
  }

  const labelKey = selectedRating > 0 ? `rating.label${selectedRating}` : null;

  return (
    <View style={styles.ratingCard}>
      <Text style={styles.ratingTitle}>{t('rating.title')}</Text>

      <View style={styles.starRow}>
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity
            key={n}
            onPress={() => handleStarTap(n)}
            style={styles.starTap}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Animated.Text
              style={[styles.star, { transform: [{ scale: starScales[n - 1] }] }]}
            >
              {n <= selectedRating ? '⭐' : '☆'}
            </Animated.Text>
          </TouchableOpacity>
        ))}
      </View>

      {labelKey && (
        <Text style={styles.ratingLabel}>{t(labelKey)}</Text>
      )}

      {selectedRating > 0 && (
        <>
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder={t('rating.placeholder')}
            placeholderTextColor={Colors.textMuted}
            multiline
            numberOfLines={3}
            maxLength={200}
            editable={!submitting}
            style={styles.ratingInput}
          />

          <TouchableOpacity
            style={[styles.ratingSubmitBtn, submitting && styles.ratingSubmitBtnDisabled]}
            onPress={() => void handleSubmit()}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting
              ? <ActivityIndicator color={Colors.white} />
              : <Text style={styles.ratingSubmitText}>{t('rating.submit')}</Text>
            }
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function OrderTrackingScreen({ navigation, route }: Props) {
  const { orderId } = route.params;
  const t = useT();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const { state: authState } = useAuth();

  const [order,      setOrder]      = useState<OrderDetailResponse | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [riderPos,   setRiderPos]   = useState<{ lat: number; lng: number } | null>(null);
  const [riderPosTs, setRiderPosTs] = useState<number | null>(null);
  const [nowTick,    setNowTick]    = useState<number>(0);
  const [cancelling, setCancelling] = useState(false);
  const [cancelSheetVisible, setCancelSheetVisible] = useState(false);
  const [selectedReason,     setSelectedReason]     = useState<string | null>(null);

  // Change-address picker + receiver-contact editor (pre-pickup only).
  const [addrPickerVisible, setAddrPickerVisible] = useState(false);
  const [savedAddresses,    setSavedAddresses]    = useState<AddressResponse[]>([]);
  const [addrSaving,        setAddrSaving]        = useState(false);
  const [receiverVisible,   setReceiverVisible]   = useState(false);
  const [recvName,          setRecvName]          = useState('');
  const [recvPhone,         setRecvPhone]         = useState('');
  const [recvSaving,        setRecvSaving]        = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  useLayoutEffect(() => {
    // Custom gradient header replaces the default nav header.
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const fetchOrder = useCallback(async () => {
    try {
      const data = await api.getOrder(orderId);
      setOrder(data);
    } catch {
      // Silently tolerate poll failures
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void fetchOrder();

    async function connectSocket() {
      const token = await StorageService.getAccessToken();
      if (!token) return;

      const socket = io(SOCKET_URL, {
        auth:       { token },
        transports: ['websocket'],
      });

      socket.on('connect', () => {
        socket.emit('order:subscribe', orderId);
      });

      socket.on('order:status', (data: { orderId: string; status: OrderStatus }) => {
        if (data.orderId !== orderId) return;
        setOrder((prev) => prev ? { ...prev, status: data.status } : prev);
      });

      socket.on('order:location', (data: { orderId: string; lat: number; lng: number }) => {
        if (data.orderId !== orderId) return;
        setRiderPos({ lat: data.lat, lng: data.lng });
        setRiderPosTs(Date.now());
      });

      socketRef.current = socket;
    }

    void connectSocket();

    // Initial paint: last-known rider location (before the first socket tick).
    void (async () => {
      try {
        const { location } = await api.getRiderLocation(orderId);
        if (location) { setRiderPos({ lat: location.lat, lng: location.lng }); setRiderPosTs(Date.now() - location.ageMs); }
      } catch { /* tolerate */ }
    })();

    pollRef.current = setInterval(() => { void fetchOrder(); }, POLL_MS);
    const tick = setInterval(() => setNowTick(Date.now()), 10_000);

    return () => {
      if (socketRef.current) {
        socketRef.current.emit('order:unsubscribe', orderId);
        socketRef.current.off('order:status');
        socketRef.current.off('order:location');
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      clearInterval(tick);
    };
  }, [orderId, fetchOrder]);

  function getStatusMessage(): string {
    if (!order) return t('common.loading');
    switch (order.status) {
      case OrderStatus.PENDING_PAYMENT:
      case OrderStatus.PAID:             return t('tracking.statusPending');
      case OrderStatus.CONFIRMED:        return t('tracking.statusConfirmed');
      case OrderStatus.PREPARING:        return t('tracking.statusPreparing');
      case OrderStatus.READY_FOR_PICKUP: return t('tracking.statusReady');
      case OrderStatus.PICKED_UP:        return t('tracking.statusPickedUp');
      case OrderStatus.OUT_FOR_DELIVERY: return t('tracking.statusOnWay');
      case OrderStatus.DELIVERED:        return t('tracking.statusDelivered');
      case OrderStatus.CANCELLED:        return t('tracking.statusCancelled');
      default:                           return t('tracking.statusPending');
    }
  }

  function handleNeedHelp() {
    const msg = encodeURIComponent(`Hi, I need help with my order #${orderId.slice(0, 8).toUpperCase()}`);
    void Linking.openURL(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`);
  }

  async function handleCancelOrder() {
    if (!selectedReason) return;
    setCancelling(true);
    try {
      await api.cancelOrder(orderId, selectedReason);
      setCancelSheetVisible(false);
      setSelectedReason(null);
      toast.show(t('cancellation.cancelled'), 'success');
      // Order status updates via the existing polling / socket subscription
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('cancellation.cancelFailed');
      Alert.alert(t('cancellation.failTitle'), msg, [{ text: 'ठीक है' }]);
    } finally {
      setCancelling(false);
    }
  }

  async function openAddrPicker() {
    setAddrPickerVisible(true);
    try {
      const data = await api.getAddresses();
      data.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      setSavedAddresses(data);
    } catch { /* tolerate */ }
  }

  async function pickAddress(addressId: string) {
    setAddrSaving(true);
    try {
      await api.updateOrderAddress(orderId, addressId);
      setAddrPickerVisible(false);
      toast.show(t('tracking.addressUpdated'), 'success');
      await fetchOrder();
    } catch (err: unknown) {
      toast.show(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setAddrSaving(false);
    }
  }

  function openReceiverEditor(name: string, phone: string) {
    setRecvName(name);
    setRecvPhone(phone);
    setReceiverVisible(true);
  }

  async function saveReceiver() {
    setRecvSaving(true);
    try {
      await api.updateOrderReceiver(orderId, recvName.trim(), recvPhone.trim());
      setReceiverVisible(false);
      toast.show(t('tracking.receiverUpdated'), 'success');
      await fetchOrder();
    } catch (err: unknown) {
      toast.show(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setRecvSaving(false);
    }
  }

  if (loading) {
    return <BrandedLoader />;
  }

  if (!order) return null;

  // ── Order-derived values — order is non-null past this point ─────────────
  // The API returns the raw Prisma object whose total field is `totalAmount`
  // (not `total` as in the OrderDetailResponse DTO), so we cast narrowly.
  const orderPrisma  = order as unknown as {
    totalAmount?: number;
    deliveryStreet?: string;
    deliveryLocality?: string;
    deliveryCity?: string;
    deliveryLat?: number | string;
    deliveryLng?: number | string;
    paymentMethod?: string;
    rating?: number | null;
    ratingComment?: string | null;
    receiverName?: string | null;
    receiverPhone?: string | null;
  };
  const custLat = orderPrisma.deliveryLat != null ? Number(orderPrisma.deliveryLat) : null;
  const custLng = orderPrisma.deliveryLng != null ? Number(orderPrisma.deliveryLng) : null;
  const showMap = custLat != null && custLng != null &&
    (order.status === OrderStatus.PICKED_UP || order.status === OrderStatus.OUT_FOR_DELIVERY);
  const riderStale = riderPosTs == null || (Math.max(nowTick, Date.now()) - riderPosTs) > LOCATION_STALE_MS;
  const currentStep  = STATUS_STEP[order.status] ?? 0;
  const isDelivered  = order.status === OrderStatus.DELIVERED;
  const isCancelled  = order.status === OrderStatus.CANCELLED;
  const totalRupees  = Math.round((orderPrisma.totalAmount ?? 0) / 100);
  const showRider    = !!order.rider && (
    order.status === OrderStatus.PICKED_UP ||
    order.status === OrderStatus.OUT_FOR_DELIVERY
  );
  const statusEmoji  = STATUS_EMOJI[order.status] ?? '🎉';
  const riderInitial = (order.rider?.name?.[0] ?? 'R').toUpperCase();
  const isCancellable =
    order.status === OrderStatus.PENDING_PAYMENT ||
    order.status === OrderStatus.PAID ||
    order.status === OrderStatus.CONFIRMED;
  const showRefundNote = !!orderPrisma.paymentMethod && orderPrisma.paymentMethod !== 'cod';
  const cancelReasons  = [
    t('cancellation.reason1'),
    t('cancellation.reason2'),
    t('cancellation.reason3'),
    t('cancellation.reason4'),
    t('cancellation.reason5'),
    t('cancellation.reason6'),
  ];

  // ── Redesigned-tracking derived values ──────────────────────────────────────
  const isCod       = (orderPrisma.paymentMethod ?? 'cod') === 'cod';
  const riderPhone  = (order.rider as { phone?: string } | null)?.phone ?? null;
  const showMapNow  = custLat != null && custLng != null && !isCancelled && !isDelivered;
  // Server-computed ETA (ETA MVP Phase 1) as a range; replaces the old hardcoded "~20 min".
  const etaText = order.eta
    ? (() => {
        const sec = order.eta!.secondsRemaining, sp = order.eta!.spreadSeconds;
        const lo = Math.max(1, Math.round((sec - sp) / 60));
        const hi = Math.max(lo, Math.round((sec + sp) / 60));
        return lo === hi ? `~${lo} ${t('tracking.minutes')}` : `${lo}–${hi} ${t('tracking.minutes')}`;
      })()
    : null;
  const headerBig   = isDelivered
    ? t('tracking.statusDelivered')
    : isCancelled
      ? t('tracking.statusCancelled')
      : etaText
        ? `${t('tracking.arrivingIn')} ${etaText}`
        : t('tracking.arrivingSoon');
  const riderMsg = order.status === OrderStatus.OUT_FOR_DELIVERY
    ? t('tracking.riderOnWay')
    : t('tracking.reachedStore');
  const fullAddress = [orderPrisma.deliveryStreet, orderPrisma.deliveryLocality, orderPrisma.deliveryCity]
    .filter(Boolean).join(', ');
  // Editable (address / receiver) only before the rider picks up.
  const isEditable =
    order.status === OrderStatus.PENDING_PAYMENT ||
    order.status === OrderStatus.PAID ||
    order.status === OrderStatus.CONFIRMED ||
    order.status === OrderStatus.PREPARING;
  const recvName_  = orderPrisma.receiverName ?? authState.name ?? '';
  const recvPhone_ = orderPrisma.receiverPhone ?? authState.phone ?? '';

  const handleBack = () =>
    navigation.canGoBack() ? navigation.goBack() : navigation.navigate('MainTabs', { screen: 'Home' });
  const handleCall = () => { if (riderPhone) void Linking.openURL(`tel:${riderPhone}`); else handleNeedHelp(); };
  const handlePayOnline = () => toast.show(t('tracking.payOnlineSoon'), 'info');

  return (
    <>
    <View style={styles.container}>
      {/* ── Gradient status header ──────────────────────────────────────── */}
      <FauxGradient
        from={Gradients.warm[0]}
        to={Gradients.warm[1]}
        steps={12}
        style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}
      >
        <View style={styles.headerTopRow}>
          <TouchableOpacity onPress={handleBack} style={styles.headerBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={22} color={Colors.white} />
          </TouchableOpacity>
          <Text style={styles.headerSmall} numberOfLines={1}>{getStatusMessage()}</Text>
        </View>
        <Text style={styles.headerBig} numberOfLines={1}>{headerBig}</Text>
      </FauxGradient>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Live map */}
        {showMapNow && custLat != null && custLng != null && (
          <View style={[styles.card, styles.mapCard]}>
            <TrackingMap customer={{ lat: custLat, lng: custLng }} rider={riderPos} stale={riderStale} etaSeconds={order.eta?.secondsRemaining ?? null} t={t} />
          </View>
        )}

        {/* Progress stepper */}
        {!isCancelled && !isDelivered && (
          <View style={[styles.card, styles.stepperCard]}>
            <ProgressStepper currentStep={currentStep} t={t} />
          </View>
        )}

        {/* Delivered celebration + rating */}
        {isDelivered && <DeliveredBanner t={t} />}
        {isDelivered && (
          <RatingCard
            t={t}
            orderId={orderId}
            initialRating={orderPrisma.rating ?? null}
            initialComment={orderPrisma.ratingComment ?? null}
            showToast={(msg, type) => toast.show(msg, type)}
          />
        )}

        {/* Pay on delivery (COD) */}
        {isCod && !isDelivered && !isCancelled && (
          <View style={styles.card}>
            <View style={styles.codRow}>
              <View style={styles.codIcon}>
                <Ionicons name="wallet-outline" size={22} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.codTitle}>{t('tracking.codPayTitle')} · ₹{totalRupees}</Text>
                <Text style={styles.codSub}>{t('tracking.codPaySub')}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.payOnlineBtn} onPress={handlePayOnline} activeOpacity={0.85}>
              <Ionicons name="flash" size={16} color={Colors.primary} />
              <Text style={styles.payOnlineText}>{t('tracking.payOnline')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Delivery partner */}
        {showRider && order.rider && (
          <View style={styles.card}>
            <View style={styles.partnerRow}>
              <View style={styles.partnerAvatar}>
                <Text style={styles.partnerAvatarText}>{riderInitial}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.partnerName} numberOfLines={1}>{order.rider.name ?? t('tracking.rider')}</Text>
                <Text style={styles.partnerSub}>{t('tracking.deliveryPartner')}</Text>
              </View>
              <TouchableOpacity style={styles.callBtn} onPress={handleCall} activeOpacity={0.85}>
                <Ionicons name="call" size={18} color={Colors.white} />
              </TouchableOpacity>
            </View>
            <View style={styles.partnerMsg}>
              <View style={styles.greenDot} />
              <Text style={styles.partnerMsgText}>{riderMsg}</Text>
            </View>
          </View>
        )}

        {/* Your delivery details */}
        <View style={styles.card}>
          <View style={styles.detailHeader}>
            <View style={styles.detailIcon}>
              <Ionicons name="bicycle-outline" size={18} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>{t('tracking.deliveryDetails')}</Text>
              <Text style={styles.helpSub}>{t('tracking.detailsSub')}</Text>
            </View>
          </View>

          <View style={styles.detailDivider} />

          {/* Delivery at {name} + address */}
          <View style={styles.detailItemRow}>
            <Ionicons name="location-outline" size={20} color={Colors.textSecondary} style={styles.detailItemIcon} />
            <View style={{ flex: 1 }}>
              <Text style={styles.detailItemTitle} numberOfLines={1}>
                {t('tracking.deliveryAt')} {recvName_}
              </Text>
              <Text style={styles.detailItemSub}>{fullAddress || 'Chirawa — 333026'}</Text>
              {isEditable && (
                <TouchableOpacity onPress={() => void openAddrPicker()} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Text style={styles.detailLink}>{t('tracking.changeAddress')} ›</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.detailDivider} />

          {/* Receiver contact */}
          <View style={styles.detailItemRow}>
            <Ionicons name="call-outline" size={20} color={Colors.textSecondary} style={styles.detailItemIcon} />
            <View style={{ flex: 1 }}>
              <Text style={styles.detailItemTitle} numberOfLines={1}>
                {recvName_}{recvPhone_ ? `, ${recvPhone_}` : ''}
              </Text>
              {isEditable && (
                <TouchableOpacity onPress={() => openReceiverEditor(recvName_, recvPhone_)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Text style={styles.detailLink}>{t('tracking.updateContact')} ›</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {/* Order summary */}
        <View style={styles.card}>
          <View style={styles.detailHeader}>
            <View style={styles.detailIcon}>
              <Ionicons name="bag-handle-outline" size={18} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>{t('tracking.orderSummary')}</Text>
              <Text style={styles.orderIdText}>#{orderId.slice(-10).toUpperCase()}</Text>
            </View>
          </View>
          {order.items.map((item, i) => (
            <ItemRow key={`${item.productId}-${i}`} item={item} />
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t('tracking.orderTotal')}</Text>
            <Text style={styles.totalValue}>₹{totalRupees}</Text>
          </View>
        </View>

        {/* Need help */}
        <TouchableOpacity style={styles.helpCard} onPress={handleNeedHelp} activeOpacity={0.85}>
          <View style={styles.detailIcon}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>{t('tracking.chatTitle')}</Text>
            <Text style={styles.helpSub}>{t('tracking.chatSub')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
        </TouchableOpacity>

        {/* Cancel order */}
        {isCancellable && !isCancelled && (
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setCancelSheetVisible(true)} activeOpacity={0.7}>
            <Text style={styles.cancelBtnText}>{t('cancellation.button')}</Text>
          </TouchableOpacity>
        )}

        {/* Footer tagline */}
        <Text style={styles.footerTag}>{t('history.lastMinuteApp')} ❤️</Text>
      </ScrollView>
    </View>

      {/* ── Cancellation reason bottom sheet ────────────────────────────── */}
      <Modal
        visible={cancelSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCancelSheetVisible(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('cancellation.title')}</Text>
            <Text style={styles.sheetSubtitle}>{t('cancellation.subtitle')}</Text>

            {cancelReasons.map((reason) => {
              const selected = selectedReason === reason;
              return (
                <TouchableOpacity
                  key={reason}
                  style={styles.reasonRow}
                  onPress={() => setSelectedReason(reason)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected && <View style={styles.radioDot} />}
                  </View>
                  <Text style={[styles.reasonText, selected && styles.reasonTextSelected]}>
                    {reason}
                  </Text>
                </TouchableOpacity>
              );
            })}

            {showRefundNote && (
              <Text style={styles.refundNote}>{t('cancellation.refundNote')}</Text>
            )}

            <TouchableOpacity
              style={[
                styles.confirmBtn,
                { backgroundColor: selectedReason ? Colors.error : Colors.border },
              ]}
              onPress={handleCancelOrder}
              disabled={!selectedReason || cancelling}
              activeOpacity={0.8}
            >
              <Text style={styles.confirmBtnText}>
                {cancelling ? t('cancellation.cancelling') : t('cancellation.confirm')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.goBackBtn}
              onPress={() => setCancelSheetVisible(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.goBackText}>{t('cancellation.goBack')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Change-address picker ───────────────────────────────────────── */}
      <Modal visible={addrPickerVisible} transparent animationType="slide" onRequestClose={() => setAddrPickerVisible(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('tracking.selectAddressTitle')}</Text>
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {savedAddresses.map((a) => (
                <TouchableOpacity
                  key={a.id} style={styles.addrPickRow} activeOpacity={0.8}
                  disabled={addrSaving} onPress={() => void pickAddress(a.id)}
                >
                  <View style={styles.addrPickTile}>
                    <Text style={styles.addrPickEmoji}>{a.label === 'घर' ? '🏠' : a.label === 'दुकान' ? '🏪' : '📍'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.addrPickLabel} numberOfLines={1}>
                      {a.label ?? 'पता'}{a.isDefault ? '  ·  Default' : ''}
                    </Text>
                    <Text style={styles.addrPickSub} numberOfLines={2}>
                      {a.street}, {a.locality}{a.city ? `, ${a.city}` : ''} — {a.pincode}
                    </Text>
                  </View>
                  {addrSaving ? <ActivityIndicator color={Colors.primary} /> : <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.goBackBtn} onPress={() => setAddrPickerVisible(false)} activeOpacity={0.7}>
              <Text style={styles.goBackText}>{t('cancellation.goBack')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Receiver-contact editor ─────────────────────────────────────── */}
      <Modal visible={receiverVisible} transparent animationType="slide" onRequestClose={() => setReceiverVisible(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('tracking.receiverTitle')}</Text>
            <TextInput
              style={styles.recvInput} value={recvName} onChangeText={setRecvName}
              placeholder={t('tracking.receiverNamePh')} placeholderTextColor={Colors.textMuted} autoCapitalize="words"
            />
            <TextInput
              style={styles.recvInput} value={recvPhone} onChangeText={setRecvPhone}
              placeholder={t('tracking.receiverPhonePh')} placeholderTextColor={Colors.textMuted}
              keyboardType="phone-pad" maxLength={10}
            />
            <TouchableOpacity
              style={[styles.recvSaveBtn, (!recvName.trim() || recvPhone.trim().length < 10 || recvSaving) && styles.recvSaveDisabled]}
              disabled={!recvName.trim() || recvPhone.trim().length < 10 || recvSaving}
              onPress={() => void saveReceiver()} activeOpacity={0.85}
            >
              {recvSaving ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.recvSaveText}>{t('tracking.save')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.goBackBtn} onPress={() => setReceiverVisible(false)} activeOpacity={0.7}>
              <Text style={styles.goBackText}>{t('cancellation.goBack')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
  container:    { flex: 1, backgroundColor: Colors.background },
  scrollContent:{ padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center' },

  card: {
    backgroundColor: Colors.card, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.sm, ...Shadow.card,
  },
  stepperCard:   { paddingVertical: Spacing.xl },
  mapCard:       { padding: Spacing.sm, gap: Spacing.sm },
  cancelledCard: { backgroundColor: Colors.errorLight, borderWidth: 1, borderColor: Colors.error },

  // Gradient status header
  header: {
    paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: 2,
    borderBottomLeftRadius: Radius.xl, borderBottomRightRadius: Radius.xl,
  },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.xs },
  headerBack: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerSmall: { flex: 1, fontSize: FontSize.sm, color: 'rgba(255,255,255,0.92)', fontWeight: '700' },
  headerBig: { fontSize: FontSize.xxl, color: Colors.white, fontWeight: '900', letterSpacing: -0.5 },

  // COD pay-on-delivery
  codRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  codIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  codTitle: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  codSub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 1, lineHeight: 18 },
  payOnlineBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.divider, paddingTop: Spacing.md,
  },
  payOnlineText: { fontSize: FontSize.md, fontWeight: '800', color: Colors.primary },

  // Delivery partner
  partnerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  partnerAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  partnerAvatarText: { fontSize: FontSize.lg, fontWeight: '900', color: Colors.white },
  partnerName: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  partnerSub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 1 },
  callBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.success, alignItems: 'center', justifyContent: 'center', ...Shadow.sm },
  partnerMsg: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.md,
    backgroundColor: Colors.successLight, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  partnerMsgText: { flex: 1, fontSize: FontSize.sm, color: Colors.success, fontWeight: '700' },

  // Detail / summary cards
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: 2 },
  detailIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  detailAddress: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20, marginLeft: 50 },
  detailDivider: { height: 1, backgroundColor: Colors.divider, marginVertical: Spacing.md },
  detailItemRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  detailItemIcon: { width: 24, textAlign: 'center' },
  detailItemTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary },
  detailItemSub: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 19, marginTop: 2 },
  detailLink: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '800', marginTop: 6 },

  // Change-address picker rows
  addrPickRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  addrPickTile: {
    width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  addrPickEmoji: { fontSize: 18 },
  addrPickLabel: { fontSize: FontSize.md, fontWeight: '800', color: Colors.textPrimary },
  addrPickSub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 1, lineHeight: 18 },

  // Receiver editor
  recvInput: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, height: 50, fontSize: FontSize.md, color: Colors.textPrimary,
    backgroundColor: Colors.surface, marginTop: Spacing.md,
  },
  recvSaveBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.lg, height: 52,
    alignItems: 'center', justifyContent: 'center', marginTop: Spacing.lg, ...Shadow.primary,
  },
  recvSaveDisabled: { opacity: 0.5 },
  recvSaveText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },
  orderIdText: { fontSize: FontSize.xs, color: Colors.textTertiary, fontWeight: '700', marginTop: 1, letterSpacing: 0.3 },

  // Need help
  helpCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.card, borderRadius: Radius.lg, padding: Spacing.lg, ...Shadow.card },
  helpSub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 1 },

  // Footer tagline
  footerTag: { fontSize: FontSize.xxl, fontWeight: '900', color: Colors.primaryMid, marginTop: Spacing.lg, paddingHorizontal: Spacing.xs },

  // Progress stepper
  stepper: { flexDirection: 'row', alignItems: 'flex-start' },
  stepCol: {
    alignItems: 'center', gap: Spacing.xs,
    flexShrink: 0, width: 64,
  },
  stepDotWrap: {
    width: 44, height: 44,
    justifyContent: 'center', alignItems: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 44, height: 44, borderRadius: Radius.full,
    borderWidth: 2, borderColor: Colors.primary,
  },
  stepDot: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 1.5, borderColor: Colors.border,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  stepDotActive: {
    borderWidth: 0,
    backgroundColor: Colors.primary,
  },
  stepDotDone: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  stepDotText: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textMuted },
  stepDotTextLight: { color: Colors.white },
  stepLabel:        { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center', fontWeight: '600' },
  stepLabelActive:  { color: Colors.primary, fontWeight: '800' },
  stepLabelDone:    { color: Colors.primary, fontWeight: '700' },
  stepLine: {
    flex: 1, height: 3, backgroundColor: Colors.border,
    marginTop: 21,
  },
  stepLineDone: { backgroundColor: Colors.primary },

  // Status emoji
  statusEmoji: {
    fontSize: 56,
    lineHeight: 79,
    includeFontPadding: false,
    textAlignVertical: 'center',
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  statusMessage: {
    fontSize: FontSize.xl, fontWeight: '800', color: Colors.text, textAlign: 'center',
  },
  statusCancelled: { color: Colors.error },
  locationBadge: {
    backgroundColor: '#E8F8F0', borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, alignSelf: 'center',
  },
  locationBadgeText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.accent },

  // Rider card
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  riderAvatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center', alignItems: 'center',
  },
  riderAvatarText: { fontSize: 30, lineHeight: 42, includeFontPadding: false },
  riderName: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  riderStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  greenDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.accent },
  riderStatusText: { fontSize: FontSize.sm, color: Colors.accent, fontWeight: '700' },

  // Delivered banner
  deliveredBanner: {
    backgroundColor: Colors.primary, borderRadius: Radius.lg,
    padding: Spacing.xxl, alignItems: 'center', gap: Spacing.md,
    overflow: 'hidden',
    ...Shadow.strong,
  },
  deliveredEmoji: { fontSize: 72, lineHeight: 101, includeFontPadding: false },
  deliveredTitle: {
    fontSize: FontSize.xxl, fontWeight: '900', color: Colors.white, textAlign: 'center',
  },
  deliveredSub: {
    fontSize: FontSize.md, color: 'rgba(255,255,255,0.92)', textAlign: 'center',
  },
  // Rating card — distinct white card rendered below the delivered celebration
  ratingCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    padding: 20,
    gap: Spacing.sm,
    alignItems: 'center',
    ...Shadow.sm,
  },
  ratingTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  starRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  starTap: { padding: 8 },
  star: {
    fontSize: 36,
    lineHeight: 44,
    includeFontPadding: false,
  },
  ratingLabel: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  ratingInput: {
    width: '100%',
    minHeight: 80,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: 12,
    marginTop: 12,
    backgroundColor: Colors.surface,
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    textAlignVertical: 'top',
  },
  ratingSubmitBtn: {
    width: '100%',
    height: MIN_TAP,
    borderRadius: Radius.lg,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    ...Shadow.primary,
  },
  ratingSubmitBtnDisabled: {
    opacity: 0.6,
  },
  ratingSubmitText: {
    color: Colors.white,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
  },
  ratingThanksStars: {
    fontSize: 36,
    lineHeight: 44,
    includeFontPadding: false,
  },
  ratingThanksText: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.success,
    textAlign: 'center',
  },

  // Confetti
  confetti: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 320,
  },
  confettiParticle: {
    position: 'absolute',
    top: 0,
    fontSize: 22,
  },

  // Section
  sectionTitle: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },

  // Item row
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    minHeight: MIN_TAP, borderBottomWidth: 1, borderBottomColor: Colors.border,
    paddingVertical: Spacing.sm,
  },
  itemName:  { flex: 1, fontSize: FontSize.md, color: Colors.text },
  itemQty:   { fontSize: FontSize.sm, color: Colors.textMuted, minWidth: 28, textAlign: 'right' },
  itemPrice: { fontSize: FontSize.md, fontWeight: '800', color: Colors.primary, minWidth: 52, textAlign: 'right' },

  // Address
  addressStreet: { fontSize: FontSize.md, color: Colors.text, fontWeight: '600' },
  addressArea:   { fontSize: FontSize.sm, color: Colors.textLight },

  // Total
  totalRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: MIN_TAP },
  totalLabel:{ fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  totalValue:{ fontSize: FontSize.xl, fontWeight: '900', color: Colors.primary },

  // Need Help
  helpBtn: {
    backgroundColor: Colors.card, borderRadius: Radius.lg,
    paddingVertical: Spacing.md, alignItems: 'center',
    minHeight: MIN_TAP, justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.border,
    ...Shadow.card,
  },
  helpBtnText: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },

  // Cancel order
  cancelBtn: {
    borderWidth:     1.5,
    borderColor:     Colors.error,
    borderRadius:    Radius.lg,
    paddingVertical: 12,
    alignItems:      'center',
    justifyContent:  'center',
    minHeight:       MIN_TAP,
    backgroundColor: Colors.errorLight,
  },
  cancelBtnText: {
    color:      Colors.error,
    fontSize:   FontSize.md,
    fontWeight: FontWeight.semibold,
  },

  // Cancellation reason bottom sheet
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius:  Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sheetHandle: {
    width: 40, height: 4,
    backgroundColor: Colors.border,
    borderRadius: Radius.full,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: FontSize.lg, fontWeight: FontWeight.bold,
    color: Colors.textPrimary, marginBottom: 4,
  },
  sheetSubtitle: {
    fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: 16,
  },
  reasonRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
    minHeight: 48,
  },
  radio: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: Colors.border,
    justifyContent: 'center', alignItems: 'center',
  },
  radioSelected: { backgroundColor: Colors.error, borderColor: Colors.error },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.white },
  reasonText: {
    flex: 1, fontSize: FontSize.md, color: Colors.textPrimary, marginLeft: 12,
  },
  reasonTextSelected: { fontWeight: FontWeight.semibold, color: Colors.error },
  refundNote: {
    fontSize: FontSize.sm, color: Colors.textSecondary,
    marginTop: 12, lineHeight: 18,
  },
  confirmBtn: {
    marginTop: 20, height: 52, borderRadius: Radius.lg,
    justifyContent: 'center', alignItems: 'center',
  },
  confirmBtnText: {
    color: Colors.white, fontWeight: FontWeight.bold, fontSize: FontSize.md,
  },
  goBackBtn: {
    marginTop: 12, alignSelf: 'center',
    minHeight: 32, justifyContent: 'center',
  },
  goBackText: { color: Colors.textSecondary, fontSize: FontSize.sm },
});
