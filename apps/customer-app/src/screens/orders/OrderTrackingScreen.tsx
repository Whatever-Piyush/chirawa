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
  Dimensions,
  Easing,
} from 'react-native';
import { io, type Socket } from 'socket.io-client';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { OrderDetailResponse, OrderItemResponse } from '@chirawa/types';
import { OrderStatus } from '@chirawa/types';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Colors, FontSize, MIN_TAP, Radius, Shadow, Spacing } from '../../theme';
import { api } from '../../services/api.service';
import { StorageService } from '../../services/storage.service';
import { useT } from '@chirawa/i18n';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'OrderTracking'>;
  route:      RouteProp<RootStackParamList, 'OrderTracking'>;
};

const DEV_HOST        = '192.168.1.6';
const SOCKET_URL      = __DEV__ ? `http://${DEV_HOST}:3000` : 'https://api.chirawa.in';
const WHATSAPP_NUMBER = '919999999999';
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
  [OrderStatus.CANCELLED]:        '😕',
};

// ─── Compact order item row ───────────────────────────────────────────────────

function ItemRow({ item }: { item: OrderItemResponse }) {
  return (
    <View style={styles.itemRow}>
      <Text style={styles.itemName} numberOfLines={1}>{item.productName}</Text>
      <Text style={styles.itemQty}>×{item.quantity}</Text>
      <Text style={styles.itemPrice}>₹{Math.round(item.subtotal / 100)}</Text>
    </View>
  );
}

// ─── Pulsing dot for active step ──────────────────────────────────────────────

function PulsingDot({ children }: { children: React.ReactNode }) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.15, duration: 700, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [scale]);
  return (
    <Animated.View style={[styles.stepDotActive, { transform: [{ scale }] }]}>
      {children}
    </Animated.View>
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
  return (
    <View style={styles.stepper}>
      {STEP_KEYS.map((key, i) => {
        const done   = i < currentStep;
        const active = i === currentStep;
        return (
          <React.Fragment key={key}>
            <View style={styles.stepCol}>
              {active ? (
                <PulsingDot>
                  <Text style={[styles.stepDotText, styles.stepDotTextLight]}>{String(i + 1)}</Text>
                </PulsingDot>
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
  const scale = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    scale.setValue(0);
    Animated.spring(scale, {
      toValue:         1,
      friction:        5,
      tension:         100,
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

      <Text style={styles.rateHow}>{t('tracking.rateHow')}</Text>
      <View style={styles.starRow}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Text key={n} style={styles.star}>⭐</Text>
        ))}
      </View>

      <TouchableOpacity style={styles.rateBtn} activeOpacity={0.85}>
        <Text style={styles.rateBtnText}>{t('tracking.rateExperience')}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function OrderTrackingScreen({ navigation, route }: Props) {
  const { orderId } = route.params;
  const t = useT();

  const [order,    setOrder]    = useState<OrderDetailResponse | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [riderPos, setRiderPos] = useState<{ lat: number; lng: number } | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: t('tracking.title') });
  }, [navigation, t]);

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
      });

      socketRef.current = socket;
    }

    void connectSocket();

    pollRef.current = setInterval(() => { void fetchOrder(); }, POLL_MS);

    return () => {
      if (socketRef.current) {
        socketRef.current.emit('order:unsubscribe', orderId);
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
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

  const currentStep  = order ? (STATUS_STEP[order.status] ?? 0) : 0;
  const isDelivered  = order?.status === OrderStatus.DELIVERED;
  const isCancelled  = order?.status === OrderStatus.CANCELLED;
  const raw          = (order ?? {}) as unknown as { totalAmount?: number; deliveryStreet?: string; deliveryLocality?: string; deliveryCity?: string };
  const totalRupees  = Math.round((raw.totalAmount ?? 0) / 100);
  const showRider    = !!order?.rider && (
    order.status === OrderStatus.PICKED_UP ||
    order.status === OrderStatus.OUT_FOR_DELIVERY
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!order) return null;

  const statusEmoji = STATUS_EMOJI[order.status] ?? '🎉';
  const riderInitial = (order.rider?.name?.[0] ?? 'R').toUpperCase();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* ── A. Progress stepper ─────────────────────────────────────────── */}
      {!isCancelled && (
        <View style={[styles.card, styles.stepperCard]}>
          <ProgressStepper currentStep={currentStep} t={t} />
        </View>
      )}

      {/* ── Delivered banner ────────────────────────────────────────────── */}
      {isDelivered && <DeliveredBanner t={t} />}

      {/* ── B. Status message with emoji ────────────────────────────────── */}
      {!isDelivered && (
        <View style={[styles.card, isCancelled && styles.cancelledCard]}>
          <StatusEmojiCard emoji={statusEmoji} />
          <Text style={[styles.statusMessage, isCancelled && styles.statusCancelled]}>
            {getStatusMessage()}
          </Text>

          {riderPos !== null && order.status === OrderStatus.OUT_FOR_DELIVERY && (
            <View style={styles.locationBadge}>
              <Text style={styles.locationBadgeText}>
                📍  {t('tracking.riderTracking')}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* ── B2. Rider card ──────────────────────────────────────────────── */}
      {showRider && (
        <View style={styles.card}>
          <View style={styles.riderRow}>
            <View style={styles.riderAvatar}>
              <Text style={styles.riderAvatarText}>🛵</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.riderName}>
                {order.rider?.name ?? `${t('tracking.rider')} ${riderInitial}`}
              </Text>
              <View style={styles.riderStatusRow}>
                <View style={styles.greenDot} />
                <Text style={styles.riderStatusText}>{t('tracking.riderOnWay')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* ── C. Order items ──────────────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('tracking.orderItems')}</Text>
        {order.items.map((item) => (
          <ItemRow key={item.productId} item={item} />
        ))}
      </View>

      {/* ── D. Delivery address ─────────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('tracking.deliveryAddress')}</Text>
        <Text style={styles.addressStreet}>{raw.deliveryStreet ?? 'Chirawa — 333026'}</Text>
        <Text style={styles.addressArea}>
          {raw.deliveryLocality ?? ''}{raw.deliveryCity ? `, ${raw.deliveryCity}` : ''}
        </Text>
      </View>

      {/* ── E. Total ────────────────────────────────────────────────────── */}
      <View style={styles.card}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t('tracking.orderTotal')}</Text>
          <Text style={styles.totalValue}>₹{totalRupees}</Text>
        </View>
      </View>

      {/* ── F. Need Help ────────────────────────────────────────────────── */}
      <TouchableOpacity
        style={styles.helpBtn}
        onPress={handleNeedHelp}
        activeOpacity={0.85}
      >
        <Text style={styles.helpBtnText}>💬  {t('tracking.needHelp')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: Colors.background },
  scrollContent:{ padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center' },

  card: {
    backgroundColor: Colors.card, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.sm, ...Shadow.card,
  },
  stepperCard:   { paddingVertical: Spacing.xl },
  cancelledCard: { backgroundColor: '#FFF5F5', borderWidth: 1, borderColor: Colors.error },

  // Progress stepper
  stepper: { flexDirection: 'row', alignItems: 'flex-start' },
  stepCol: {
    alignItems: 'center', gap: Spacing.xs,
    flexShrink: 0, width: 64,
  },
  stepDot: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 2, borderColor: Colors.border,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: Colors.white,
  },
  stepDotActive: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
    ...Shadow.strong,
  },
  stepDotDone: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  stepDotText: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.textMuted },
  stepDotTextLight: { color: Colors.white },
  stepLabel:        { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center', fontWeight: '600' },
  stepLabelActive:  { color: Colors.primary, fontWeight: '800' },
  stepLabelDone:    { color: Colors.primary, fontWeight: '700' },
  stepLine: {
    flex: 1, height: 2, backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: Spacing.xl,
  },
  stepLineDone: { backgroundColor: Colors.primary },

  // Status emoji
  statusEmoji: {
    fontSize: 64,
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
  riderAvatarText: { fontSize: 30 },
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
  deliveredEmoji: { fontSize: 72 },
  deliveredTitle: {
    fontSize: FontSize.xxl, fontWeight: '900', color: Colors.white, textAlign: 'center',
  },
  deliveredSub: {
    fontSize: FontSize.md, color: 'rgba(255,255,255,0.92)', textAlign: 'center',
  },
  rateHow: {
    color: Colors.white,
    fontSize: FontSize.md,
    fontWeight: '700',
    marginTop: Spacing.md,
  },
  starRow: { flexDirection: 'row', gap: 6 },
  star:    { fontSize: 28 },
  rateBtn: {
    marginTop: Spacing.sm, backgroundColor: Colors.white,
    borderRadius: Radius.full, paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md, minHeight: MIN_TAP, justifyContent: 'center',
  },
  rateBtnText: { fontSize: FontSize.md, fontWeight: '900', color: Colors.primary },

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
});
