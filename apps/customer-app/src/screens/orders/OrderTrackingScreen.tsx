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

// 9 DB states → 5 display phases (V2 timeline): Confirmed · Packing · Picked up · On the way · Delivered.
const STATUS_STEP5: Partial<Record<OrderStatus, number>> = {
  [OrderStatus.PENDING_PAYMENT]:  0,
  [OrderStatus.PAID]:             0,
  [OrderStatus.CONFIRMED]:        0,
  [OrderStatus.PREPARING]:        1,
  [OrderStatus.READY_FOR_PICKUP]: 1,
  [OrderStatus.PICKED_UP]:        2,
  [OrderStatus.OUT_FOR_DELIVERY]: 3,
  [OrderStatus.DELIVERED]:        4,
};

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

// Local 12-hour clock formatter (avoids relying on Intl on Hermes/Android).
function fmtClock(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

// ETA hero (V2 P1.1) — range before pickup, a live local countdown once on the way.
// Clock-skew safe: anchor on the client receive-time of each `eta` + secondsRemaining.
function EtaHero({ eta, active, t }: {
  eta?: { secondsRemaining: number; spreadSeconds: number; serverNow: string; source: string };
  active: boolean;
  t: (key: string) => string;
}) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const [now, setNow] = useState(Date.now());
  const anchor = useRef<{ ms: number; sec: number } | null>(null);
  useEffect(() => {
    if (eta) anchor.current = { ms: Date.now(), sec: eta.secondsRemaining };
  }, [eta?.secondsRemaining, eta?.serverNow]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  if (!eta || !anchor.current) {
    return (
      <View style={[styles.card, styles.etaHero]}>
        <Ionicons name="time-outline" size={22} color={Colors.primary} />
        <Text style={styles.etaHeroBig}>{t('tracking.calculatingEta')}</Text>
      </View>
    );
  }
  const liveSec = Math.max(0, anchor.current.sec - (now - anchor.current.ms) / 1000);
  const byClock = fmtClock(Date.now() + liveSec * 1000);
  let primary: string;
  if (active) {
    // Past the ETA (liveSec hit 0) → "Arriving soon" instead of a stuck "~1 min"
    // (stopgap until the Phase-2 delay engine — pre-commit review §3).
    const m = Math.ceil(liveSec / 60);
    primary = m <= 0
      ? t('tracking.arrivingSoon')
      : `${t('tracking.arrivingIn')} ~${m} ${t('tracking.minutes')}`;
  } else {
    const sp = eta.spreadSeconds;
    const lo = Math.max(1, Math.round((anchor.current.sec - sp) / 60));
    const hi = Math.max(lo, Math.round((anchor.current.sec + sp) / 60));
    primary = lo === hi
      ? `${t('tracking.arrivingIn')} ~${lo} ${t('tracking.minutes')}`
      : `${t('tracking.arrivingIn')} ${lo}–${hi} ${t('tracking.minutes')}`;
  }
  return (
    <View style={[styles.card, styles.etaHero]}>
      <Ionicons name="time-outline" size={22} color={Colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.etaHeroBig} numberOfLines={1}>{primary}</Text>
        <Text style={styles.etaHeroSub}>
          {t('tracking.byTime')} {byClock}{eta.source === 'fallback' ? ` · ${t('tracking.etaEstimate')}` : ''}
        </Text>
      </View>
    </View>
  );
}

// Vertical order timeline (V2 P1.4) — 5 phases with timestamps, collapsible, cancelled branch.
function OrderTimeline({ status, ts, t }: {
  status: OrderStatus;
  ts: { confirmed?: string | null; packing?: string | null; pickedUp?: string | null; onTheWay?: string | null; delivered?: string | null; cancelled?: string | null };
  t: (key: string) => string;
}) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const [open, setOpen] = useState(false);
  const isCancelled = status === OrderStatus.CANCELLED;
  const idx = STATUS_STEP5[status] ?? 0;
  const phases = [
    { label: t('tracking.confirmed'), at: ts.confirmed },
    { label: t('tracking.preparing'), at: ts.packing },
    { label: t('tracking.pickedUp'),  at: ts.pickedUp },
    { label: t('tracking.onTheWay'),  at: ts.onTheWay },
    { label: t('tracking.delivered'), at: ts.delivered },
  ];
  const currentLabel = isCancelled ? t('tracking.statusCancelled') : (phases[idx]?.label ?? '');
  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.tlHeader} activeOpacity={0.7} onPress={() => setOpen((v) => !v)}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{t('tracking.progressTitle')}</Text>
          <Text style={styles.tlCurrent}>{currentLabel}</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textTertiary} />
      </TouchableOpacity>
      {open && (
        <View style={styles.tlBody}>
          {phases.map((p, i) => {
            const active = !isCancelled && i === idx;
            // A phase is "done" once its timestamp exists — robust for the cancelled branch
            // (reached phases stay ticked) and for any skipped-phase data gap (pre-commit review §1).
            const done   = !active && !!p.at;
            return (
              <View key={p.label} style={styles.tlRow}>
                <View style={styles.tlDotCol}>
                  {active ? (
                    <View style={styles.stepDotWrap}><PulsingRing /><View style={[styles.tlDot, styles.tlDotActive]} /></View>
                  ) : (
                    <View style={[styles.tlDot, done && styles.tlDotDone]}>{done ? <Text style={styles.tlDotTick}>✓</Text> : null}</View>
                  )}
                  {i < phases.length - 1 && <View style={[styles.tlLine, done && styles.tlLineDone]} />}
                </View>
                <View style={styles.tlTextCol}>
                  <Text style={[styles.tlLabel, (done || active) && styles.tlLabelActive]}>{p.label}</Text>
                  <Text style={styles.tlTime}>{p.at ? fmtClock(new Date(p.at).getTime()) : '—'}</Text>
                </View>
              </View>
            );
          })}
          {isCancelled && (
            <View style={styles.tlRow}>
              <View style={styles.tlDotCol}><View style={[styles.tlDot, styles.tlDotCancelled]}><Text style={styles.tlDotTick}>✕</Text></View></View>
              <View style={styles.tlTextCol}>
                <Text style={[styles.tlLabel, styles.tlLabelCancelled]}>{t('tracking.statusCancelled')}</Text>
                <Text style={styles.tlTime}>{ts.cancelled ? fmtClock(new Date(ts.cancelled).getTime()) : '—'}</Text>
              </View>
            </View>
          )}
        </View>
      )}
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
  // Tracking V2 Sprint 1: socket-drop banner (P0.1) + item-unavailable banner (P0.3).
  const [socketStale, setSocketStale] = useState(false);
  const [itemAlert,   setItemAlert]   = useState<
    { productName: string; refundedPaise: number; cancelled: boolean; suggestion?: { productId: string; name: string } } | null
  >(null);

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
        setSocketStale(false);   // P0.1: clear the "reconnecting" banner on (re)connect
      });
      // P0.1: socket-drop feedback — data still flows via the 15s poll, so this is informational.
      socket.on('disconnect',    () => setSocketStale(true));
      socket.on('connect_error', () => setSocketStale(true));

      socket.on('order:status', (data: { orderId: string; status: OrderStatus }) => {
        if (data.orderId !== orderId) return;
        setOrder((prev) => prev ? { ...prev, status: data.status } : prev);
      });

      socket.on('order:location', (data: { orderId: string; lat: number; lng: number }) => {
        if (data.orderId !== orderId) return;
        setRiderPos({ lat: data.lat, lng: data.lng });
        setRiderPosTs(Date.now());
      });

      // Server-computed ETA push (ETA P3 / review #4). Merge it into order.eta so the
      // header + map badge update live, without waiting for the 15s poll. Idempotent —
      // the dual-room (order + user) duplicate emit is harmless.
      socket.on('order:eta', (data: {
        orderId: string; secondsRemaining: number; spreadSeconds: number; serverNow: string; source: string;
      }) => {
        if (data.orderId !== orderId) return;
        setOrder((prev) => prev ? {
          ...prev,
          eta: {
            secondsRemaining: data.secondsRemaining,
            spreadSeconds:    data.spreadSeconds,
            serverNow:        data.serverNow,
            source:           data.source,
          },
        } : prev);
      });

      // P0.3: an item went out of stock at pickup — the line was refunded (or the order
      // cancelled). Surface it inline + refetch so the bill + refund card reconcile.
      socket.on('order:item-unavailable', (data: {
        orderId: string; productName: string; refundedPaise: number; cancelled: boolean;
        suggestion?: { productId: string; name: string };
      }) => {
        if (data.orderId !== orderId) return;
        setItemAlert({
          productName:   data.productName,
          refundedPaise: data.refundedPaise,
          cancelled:     data.cancelled,
          ...(data.suggestion ? { suggestion: data.suggestion } : {}),
        });
        void fetchOrder();
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
        socketRef.current.off('order:eta');
        socketRef.current.off('order:item-unavailable');
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

  // P0.1: the load finished but we have no order → the fetch failed. Show a recoverable
  // error state with Retry instead of a blank screen (was `return null`).
  if (!order) {
    return (
      <View style={[styles.errorWrap, { paddingTop: insets.top }]}>
        <Ionicons name="cloud-offline-outline" size={48} color={Colors.textTertiary} />
        <Text style={styles.errorTitle}>{t('tracking.loadErrorTitle')}</Text>
        <Text style={styles.errorSub}>{t('tracking.loadErrorSub')}</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          activeOpacity={0.85}
          onPress={() => { setLoading(true); void fetchOrder(); }}
        >
          <Text style={styles.retryBtnText}>{t('tracking.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

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
    // Phase timestamps (ETA Phase 1) — raw passthrough, used by the V2 timeline.
    createdAt?: string | null;
    confirmedAt?: string | null;
    preparingAt?: string | null;
    pickedUpAt?: string | null;
    outForDeliveryAt?: string | null;
    deliveredAt?: string | null;
    cancelledAt?: string | null;
  };
  const custLat = orderPrisma.deliveryLat != null ? Number(orderPrisma.deliveryLat) : null;
  const custLng = orderPrisma.deliveryLng != null ? Number(orderPrisma.deliveryLng) : null;
  const showMap = custLat != null && custLng != null &&
    (order.status === OrderStatus.PICKED_UP || order.status === OrderStatus.OUT_FOR_DELIVERY);
  const riderStale = riderPosTs == null || (Math.max(nowTick, Date.now()) - riderPosTs) > LOCATION_STALE_MS;
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
  // P1.2 — show the live map only during active delivery (matches the rider reveal);
  // pre-pickup we show a packing illustration instead of an empty "location unavailable" map.
  const isActiveDelivery = order.status === OrderStatus.PICKED_UP || order.status === OrderStatus.OUT_FOR_DELIVERY;
  const showMapNow  = isActiveDelivery && custLat != null && custLng != null;
  const showPrepIllustration = !isActiveDelivery && !isCancelled && !isDelivered;
  // P1.1 — the header is now phase-focused; the ETA lives in the EtaHero card below.
  const headerBig   = getStatusMessage();
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
          <Text style={styles.headerSmall} numberOfLines={1}>#{orderId.slice(-6).toUpperCase()}</Text>
        </View>
        <Text style={styles.headerBig} numberOfLines={1}>{headerBig}</Text>
      </FauxGradient>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* P0.1 — socket-drop banner (data still arrives via the 15s poll) */}
        {socketStale && (
          <View style={styles.reconnectBanner}>
            <ActivityIndicator size="small" color={Colors.textSecondary} />
            <Text style={styles.reconnectText}>{t('tracking.reconnecting')}</Text>
          </View>
        )}

        {/* P0.3 — item went out of stock at pickup (line refunded / order cancelled) */}
        {itemAlert && (
          <View style={styles.oosBanner}>
            <Ionicons name="alert-circle-outline" size={20} color={Colors.warning ?? Colors.primary} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.oosText}>
                {itemAlert.cancelled
                  ? t('tracking.orderCancelledRefunded')
                  : `‘${itemAlert.productName}’ ${t('tracking.itemOOS')} — ₹${Math.round(itemAlert.refundedPaise / 100)} ${t('tracking.refundedWord')}`}
              </Text>
              {itemAlert.suggestion && !itemAlert.cancelled && (
                <TouchableOpacity onPress={() => navigation.navigate('ProductDetail', { productId: itemAlert.suggestion!.productId })} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Text style={styles.oosSubLink}>{itemAlert.suggestion.name} · {t('tracking.addInstead')} ›</Text>
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity onPress={() => setItemAlert(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={18} color={Colors.textTertiary} />
            </TouchableOpacity>
          </View>
        )}

        {/* P1.1 — ETA hero (range pre-pickup, live countdown on the way) */}
        {!isDelivered && !isCancelled && (
          <EtaHero eta={order.eta} active={isActiveDelivery} t={t} />
        )}

        {/* P0.2 — refund visibility */}
        {order.refund && order.refund.amountPaise > 0 && (
          <View style={styles.refundCard}>
            <View style={styles.refundIcon}>
              <Ionicons name="cash-outline" size={20} color={Colors.success ?? Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.refundCardTitle}>
                {t('tracking.refundLabel')} ₹{Math.round(order.refund.amountPaise / 100)}
              </Text>
              <Text style={styles.refundCardSub}>
                {order.refund.destination === 'cash_adjustment'
                  ? t('tracking.refundCashAdjust')
                  : t('tracking.refundOriginal')}
              </Text>
            </View>
          </View>
        )}

        {/* Live map — V2 P1.2: only during active delivery (picked_up / out_for_delivery) */}
        {showMapNow && custLat != null && custLng != null && (
          <View style={[styles.card, styles.mapCard]}>
            <TrackingMap customer={{ lat: custLat, lng: custLng }} rider={riderPos} stale={riderStale} etaSeconds={order.eta?.secondsRemaining ?? null} t={t} />
          </View>
        )}

        {/* Pre-pickup packing illustration (replaces the empty "location unavailable" map) */}
        {showPrepIllustration && (
          <View style={[styles.card, styles.prepCard]}>
            <Text style={styles.prepEmoji}>🧺</Text>
            <Text style={styles.prepText}>{t('tracking.packingSub')}</Text>
          </View>
        )}

        {/* Order timeline — V2 P1.4 (5 phases · timestamps · collapsible · cancelled branch) */}
        {!isDelivered && (
          <OrderTimeline
            status={order.status}
            ts={{
              confirmed: orderPrisma.confirmedAt ?? orderPrisma.createdAt,
              packing:   orderPrisma.preparingAt,
              pickedUp:  orderPrisma.pickedUpAt,
              onTheWay:  orderPrisma.outForDeliveryAt,
              delivered: orderPrisma.deliveredAt,
              cancelled: orderPrisma.cancelledAt,
            }}
            t={t}
          />
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

  // ── Tracking V2 Sprint 2 (ETA hero · packing illustration · timeline) ──
  etaHero:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  etaHeroBig:   { fontSize: FontSize.lg, fontWeight: '800', color: Colors.textPrimary },
  etaHeroSub:   { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 1 },

  prepCard:     { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.xl, gap: Spacing.xs },
  prepEmoji:    { fontSize: 40 },
  prepText:     { fontSize: FontSize.md, fontWeight: '700', color: Colors.textSecondary },

  tlHeader:     { flexDirection: 'row', alignItems: 'center' },
  tlCurrent:    { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '700', marginTop: 1 },
  tlBody:       { marginTop: Spacing.md },
  tlRow:        { flexDirection: 'row', gap: Spacing.md },
  tlDotCol:     { alignItems: 'center', width: 22 },
  tlDot:        { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: Colors.border, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  tlDotDone:    { backgroundColor: Colors.success ?? Colors.primary, borderColor: Colors.success ?? Colors.primary },
  tlDotActive:  { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tlDotCancelled: { backgroundColor: Colors.error, borderColor: Colors.error },
  tlDotTick:    { color: Colors.white, fontSize: 9, fontWeight: '900' },
  tlLine:       { width: 2, flex: 1, minHeight: 18, backgroundColor: Colors.border, marginVertical: 2 },
  tlLineDone:   { backgroundColor: Colors.success ?? Colors.primary },
  tlTextCol:    { flex: 1, paddingBottom: Spacing.md },
  tlLabel:      { fontSize: FontSize.sm, color: Colors.textTertiary, fontWeight: '600' },
  tlLabelActive:{ color: Colors.textPrimary, fontWeight: '800' },
  tlLabelCancelled: { color: Colors.error, fontWeight: '800' },
  tlTime:       { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },

  // ── Tracking V2 Sprint 1 ──────────────────────────────────────────
  errorWrap:    { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  errorTitle:   { fontSize: FontSize.lg, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center', marginTop: Spacing.sm },
  errorSub:     { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center' },
  retryBtn:     { marginTop: Spacing.md, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md },
  retryBtnText: { color: Colors.white, fontWeight: '800', fontSize: FontSize.sm },

  reconnectBanner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceAlt, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  reconnectText:   { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '600' },

  oosBanner:   { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, backgroundColor: Colors.warningLight, borderRadius: Radius.md, padding: Spacing.md },
  oosText:     { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: '600' },
  oosSubLink:  { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '700', marginTop: 2 },

  refundCard:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.successLight, borderRadius: Radius.lg, padding: Spacing.lg },
  refundIcon:      { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  refundCardTitle: { fontSize: FontSize.md, fontWeight: '800', color: Colors.textPrimary },
  refundCardSub:   { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 1 },

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
