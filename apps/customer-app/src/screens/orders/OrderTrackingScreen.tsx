import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Linking,
  ActivityIndicator,
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
const WHATSAPP_NUMBER = '919999999999'; // Placeholder — replace with real support number
const POLL_MS         = 15_000;

// Map every backend status to one of the 4 visible stepper steps (0–3)
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

// Keys must exist in translations.tracking
const STEP_KEYS = [
  'tracking.confirmed',
  'tracking.preparing',
  'tracking.onTheWay',
  'tracking.delivered',
] as const;

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
              <View style={[
                styles.stepDot,
                done   && styles.stepDotDone,
                active && styles.stepDotActive,
              ]}>
                <Text style={[styles.stepDotText, (done || active) && styles.stepDotTextLight]}>
                  {done ? '✓' : String(i + 1)}
                </Text>
              </View>
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

// ─── Delivered success banner (Animated API) ──────────────────────────────────

function DeliveredBanner({ t }: { t: (key: string) => string }) {
  const scale   = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue:         1,
        friction:        5,
        tension:         40,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue:         1,
        duration:        500,
        useNativeDriver: true,
      }),
    ]).start();
  }, [scale, opacity]);

  return (
    <Animated.View style={[styles.deliveredBanner, { opacity }]}>
      <Animated.Text style={[styles.deliveredEmoji, { transform: [{ scale }] }]}>
        🎉
      </Animated.Text>
      <Text style={styles.deliveredTitle}>{t('tracking.orderDelivered')}</Text>
      <Text style={styles.deliveredSub}>{t('tracking.thankYou')}</Text>
      <TouchableOpacity style={styles.rateBtn} activeOpacity={0.8}>
        <Text style={styles.rateBtnText}>⭐  {t('tracking.rateExperience')}</Text>
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

  // ─── Header ────────────────────────────────────────────────────────────────

  useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: t('tracking.title') });
  }, [navigation, t]);

  // ─── Fetch order ───────────────────────────────────────────────────────────

  const fetchOrder = useCallback(async () => {
    try {
      const data = await api.getOrder(orderId);
      setOrder(data);
    } catch {
      // Silently tolerate poll failures — user keeps last-known state
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  // ─── Socket + polling setup ────────────────────────────────────────────────

  useEffect(() => {
    void fetchOrder(); // initial load

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

      // Real-time status push from server's event bus
      socket.on('order:status', (data: { orderId: string; status: OrderStatus }) => {
        if (data.orderId !== orderId) return;
        setOrder((prev) => prev ? { ...prev, status: data.status } : prev);
      });

      // Rider location push (every ~8 s from rider app)
      socket.on('order:location', (data: { orderId: string; lat: number; lng: number }) => {
        if (data.orderId !== orderId) return;
        setRiderPos({ lat: data.lat, lng: data.lng });
      });

      socketRef.current = socket;
    }

    void connectSocket();

    // 15-second polling fallback for missed socket events
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

  // ─── Helpers ───────────────────────────────────────────────────────────────

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

  // ─── Derived values ────────────────────────────────────────────────────────

  const currentStep  = order ? (STATUS_STEP[order.status] ?? 0) : 0;
  const isDelivered  = order?.status === OrderStatus.DELIVERED;
  const isCancelled  = order?.status === OrderStatus.CANCELLED;
  const totalRupees  = order ? Math.round(order.total / 100) : 0;
  const showRider    = !!order?.rider && (
    order.status === OrderStatus.PICKED_UP ||
    order.status === OrderStatus.OUT_FOR_DELIVERY
  );

  // ─── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!order) return null;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* ── A. Progress stepper (hidden when cancelled) ───────────────────── */}
      {!isCancelled && (
        <View style={[styles.card, styles.stepperCard]}>
          <ProgressStepper currentStep={currentStep} t={t} />
        </View>
      )}

      {/* ── Delivered success animation ───────────────────────────────────── */}
      {isDelivered && <DeliveredBanner t={t} />}

      {/* ── B. Status message ─────────────────────────────────────────────── */}
      {!isDelivered && (
        <View style={[styles.card, isCancelled && styles.cancelledCard]}>
          <Text style={[styles.statusMessage, isCancelled && styles.statusCancelled]}>
            {getStatusMessage()}
          </Text>

          {/* Rider info when actively delivering */}
          {showRider && (
            <View style={styles.riderBadge}>
              <Text style={styles.riderBadgeText}>
                🚴  {t('tracking.rider')}: {order.rider!.name}
              </Text>
            </View>
          )}

          {/* Live location indicator when riderPos is received */}
          {riderPos !== null && order.status === OrderStatus.OUT_FOR_DELIVERY && (
            <View style={styles.locationBadge}>
              <Text style={styles.locationBadgeText}>
                📍  {t('tracking.riderTracking')}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* ── C. Order items ────────────────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('tracking.orderItems')}</Text>
        {order.items.map((item) => (
          <ItemRow key={item.productId} item={item} />
        ))}
      </View>

      {/* ── D. Delivery address ───────────────────────────────────────────── */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('tracking.deliveryAddress')}</Text>
        <Text style={styles.addressStreet}>{order.deliveryAddress.street}</Text>
        <Text style={styles.addressArea}>
          {order.deliveryAddress.locality}, {order.deliveryAddress.city}
        </Text>
      </View>

      {/* ── E. Total ──────────────────────────────────────────────────────── */}
      <View style={styles.card}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t('tracking.orderTotal')}</Text>
          <Text style={styles.totalValue}>₹{totalRupees}</Text>
        </View>
      </View>

      {/* ── F. Need Help ──────────────────────────────────────────────────── */}
      <TouchableOpacity
        style={styles.helpBtn}
        onPress={handleNeedHelp}
        activeOpacity={0.8}
      >
        <Text style={styles.helpBtnText}>💬  {t('tracking.needHelp')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: Colors.background },
  scrollContent:{ padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Cards
  card: {
    backgroundColor: Colors.card, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.sm, ...Shadow.card,
  },
  stepperCard:   { paddingVertical: Spacing.xl },
  cancelledCard: { backgroundColor: '#FFF5F5', borderWidth: 1, borderColor: Colors.error },

  // ── Progress stepper
  stepper: {
    flexDirection: 'row', alignItems: 'flex-start',
  },
  stepCol: {
    alignItems: 'center', gap: Spacing.xs,
    // Each step col shrinks to content; the line between takes remaining space
    flexShrink: 0, width: 64,
  },
  stepDot: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 2, borderColor: Colors.border,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: Colors.white,
  },
  stepDotActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  stepDotDone:   { borderColor: Colors.success, backgroundColor: Colors.success },
  stepDotText:   { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textMuted },
  stepDotTextLight: { color: Colors.white },
  stepLabel:     { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
  stepLabelActive: { color: Colors.primary, fontWeight: '700' },
  stepLabelDone:   { color: Colors.success, fontWeight: '600' },
  stepLine: {
    flex: 1, height: 2, backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: Spacing.xl, // align with dot centre
  },
  stepLineDone: { backgroundColor: Colors.success },

  // ── Delivered banner
  deliveredBanner: {
    backgroundColor: Colors.primary, borderRadius: Radius.lg,
    padding: Spacing.xxl, alignItems: 'center', gap: Spacing.md,
    ...Shadow.card,
  },
  deliveredEmoji: { fontSize: 72 },
  deliveredTitle: {
    fontSize: FontSize.xxl, fontWeight: '900', color: Colors.white, textAlign: 'center',
  },
  deliveredSub: {
    fontSize: FontSize.md, color: 'rgba(255,255,255,0.85)', textAlign: 'center',
  },
  rateBtn: {
    marginTop: Spacing.sm, backgroundColor: Colors.white,
    borderRadius: Radius.full, paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md, minHeight: MIN_TAP, justifyContent: 'center',
  },
  rateBtnText: { fontSize: FontSize.md, fontWeight: '800', color: Colors.primary },

  // ── Status message
  statusMessage: {
    fontSize: FontSize.xl, fontWeight: '800', color: Colors.text, textAlign: 'center',
  },
  statusCancelled: { color: Colors.error },
  riderBadge: {
    backgroundColor: Colors.background, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, alignSelf: 'center',
  },
  riderBadgeText: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  locationBadge: {
    backgroundColor: '#EAF7EE', borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, alignSelf: 'center',
  },
  locationBadgeText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.success },

  // ── Section
  sectionTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },

  // ── Item row
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    minHeight: MIN_TAP, borderBottomWidth: 1, borderBottomColor: Colors.border,
    paddingVertical: Spacing.sm,
  },
  itemName:  { flex: 1, fontSize: FontSize.md, color: Colors.text },
  itemQty:   { fontSize: FontSize.sm, color: Colors.textMuted, minWidth: 28, textAlign: 'right' },
  itemPrice: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primary, minWidth: 52, textAlign: 'right' },

  // ── Address
  addressStreet: { fontSize: FontSize.md, color: Colors.text, fontWeight: '500' },
  addressArea:   { fontSize: FontSize.sm, color: Colors.textLight },

  // ── Total
  totalRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: MIN_TAP },
  totalLabel:{ fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  totalValue:{ fontSize: FontSize.xl, fontWeight: '900', color: Colors.primary },

  // ── Need Help button
  helpBtn: {
    backgroundColor: Colors.card, borderRadius: Radius.lg,
    paddingVertical: Spacing.md, alignItems: 'center',
    minHeight: MIN_TAP, justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.border,
    ...Shadow.card,
  },
  helpBtnText: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
});
