import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Modal, Alert, ActivityIndicator, Vibration, AppState,
} from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { Audio } from 'expo-av';
import { Colors, Spacing, FontSize, Radius, Shadow } from '../../theme';
import { SellerApi } from '../../services/api.service';
import { StorageService } from '../../services/storage.service';
import { useAuth } from '../../context/AuthContext';

const DEV_HOST = '192.168.1.6'; // Update to your Mac's LAN IP
const SOCKET_URL = __DEV__ ? `http://${DEV_HOST}:3000` : 'https://api.chirawa.in';

const REJECT_REASONS = [
  'Stock nahi hai',
  'Dukaan band hai',
  'Item available nahi',
  'Bahut zyada order',
];

interface OrderItem  { productName: string; quantity: number; unitPrice: number }
interface IncomingOrder {
  orderId: string; items: OrderItem[];
  totalAmount: number; paymentMethod: string; deliveryLocality: string;
}
interface ActiveOrder {
  id: string; status: string; items: OrderItem[];
  totalAmount: number; paymentMethod: string; deliveryLocality: string;
  createdAt: string;
}

export default function OrderQueueScreen() {
  const { state }                   = useAuth();
  const [orders,     setOrders]     = useState<ActiveOrder[]>([]);
  const [newOrder,   setNewOrder]   = useState<IncomingOrder | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [actionLoad, setActionLoad] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const socketRef   = useRef<Socket | null>(null);
  const soundRef    = useRef<Audio.Sound | null>(null);
  const vibInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load existing orders ──────────────────────────────────────────────────
  const loadOrders = useCallback(async () => {
    if (!state.token) return;
    try {
      const data = await SellerApi.getOrders(state.token) as ActiveOrder[];
      setOrders(data.filter((o) => !['delivered', 'cancelled'].includes(o.status)));
    } catch (e) {
      console.error('Load orders failed:', e);
    } finally {
      setLoading(false);
    }
  }, [state.token]);

  useEffect(() => { void loadOrders(); }, [loadOrders]);

  // ── Socket.io connection ──────────────────────────────────────────────────
  useEffect(() => {
    if (!state.token) return;

    const socket = io(SOCKET_URL, {
      auth:       { token: state.token },
      transports: ['websocket'],
    });

    socket.on('connect', () => console.log('Seller socket connected'));

    socket.on('order:new', (data: IncomingOrder) => {
      setNewOrder(data);
      void startAlarm();
    });

    socket.on('order:status', () => { void loadOrders(); });

    socketRef.current = socket;
    return () => {
      socket.disconnect();
      void stopAlarm();
    };
  }, [state.token, loadOrders]);

  // ── Alarm (continuous vibration + sound) ─────────────────────────────────
  async function startAlarm() {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS:       false,
        staysActiveInBackground:  true,
        shouldDuckAndroid:        false,
        playThroughEarpieceAndroid: false,
      });
    } catch (e) {
      console.warn('Audio mode:', e);
    }

    // Vibrate every 1.5 seconds
    vibInterval.current = setInterval(() => {
      Vibration.vibrate([500, 500, 500]);
    }, 1500);
  }

  async function stopAlarm() {
    if (vibInterval.current) {
      clearInterval(vibInterval.current);
      vibInterval.current = null;
    }
    Vibration.cancel();
    if (soundRef.current) {
      await soundRef.current.stopAsync().catch(() => {});
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
  }

  // ── Accept order ──────────────────────────────────────────────────────────
  async function handleAccept() {
    if (!newOrder || !state.token) return;
    setActionLoad(true);
    try {
      await SellerApi.acceptOrder(newOrder.orderId, state.token);
      await stopAlarm();
      setNewOrder(null);
      await loadOrders();
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Accept nahi hua');
    } finally {
      setActionLoad(false);
    }
  }

  // ── Reject order ──────────────────────────────────────────────────────────
  async function handleReject(reason: string) {
    if (!newOrder || !state.token) return;
    setActionLoad(true);
    try {
      await SellerApi.rejectOrder(newOrder.orderId, reason, state.token);
      await stopAlarm();
      setNewOrder(null);
      setShowReject(false);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Reject nahi hua');
    } finally {
      setActionLoad(false);
    }
  }

  // ── Status update ─────────────────────────────────────────────────────────
  async function updateStatus(orderId: string, action: 'preparing' | 'ready') {
    if (!state.token) return;
    try {
      if (action === 'preparing') await SellerApi.markPreparing(orderId, state.token);
      else                         await SellerApi.markReady(orderId, state.token);
      await loadOrders();
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Update nahi hua');
    }
  }

  const statusLabel: Record<string, string> = {
    confirmed:        '✅ Confirm',
    preparing:        '🍳 Taiyar Ho Raha',
    ready_for_pickup: '📦 Rider Ka Intezaar',
    picked_up:        '🚴 Rider Le Gaya',
    paid:             '💳 Payment Hua',
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={Colors.accent} size="large" /></View>;
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Order Queue</Text>
        <View style={styles.liveDot} />
      </View>

      {/* Active orders */}
      {orders.length === 0
        ? <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>😴</Text>
            <Text style={styles.emptyText}>Abhi koi order nahi</Text>
          </View>
        : <FlatList
            data={orders}
            keyExtractor={(o) => o.id}
            contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.md }}
            renderItem={({ item }) => (
              <View style={styles.orderCard}>
                <View style={styles.orderHeader}>
                  <Text style={styles.orderId}>#{item.id.slice(-6).toUpperCase()}</Text>
                  <Text style={styles.orderStatus}>{statusLabel[item.status] ?? item.status}</Text>
                </View>
                {item.items.map((it, i) => (
                  <Text key={i} style={styles.orderItem}>
                    • {it.productName} × {it.quantity}
                  </Text>
                ))}
                <Text style={styles.orderTotal}>
                  ₹{Math.round(item.totalAmount / 100)} • {item.paymentMethod.toUpperCase()} • {item.deliveryLocality}
                </Text>
                <View style={styles.actionRow}>
                  {item.status === 'confirmed' &&
                    <TouchableOpacity style={styles.prepBtn} onPress={() => void updateStatus(item.id, 'preparing')}>
                      <Text style={styles.prepBtnText}>🍳 Taiyar Karna Shuru</Text>
                    </TouchableOpacity>
                  }
                  {item.status === 'preparing' &&
                    <TouchableOpacity style={styles.readyBtn} onPress={() => void updateStatus(item.id, 'ready')}>
                      <Text style={styles.readyBtnText}>✅ Ready Hai!</Text>
                    </TouchableOpacity>
                  }
                </View>
              </View>
            )}
          />
      }

      {/* Full-screen new order modal */}
      <Modal visible={!!newOrder} animationType="slide" statusBarTranslucent>
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>🔔 NAYA ORDER!</Text>
          <Text style={styles.modalAmount}>₹{Math.round((newOrder?.totalAmount ?? 0) / 100)}</Text>
          <Text style={styles.modalMeta}>
            {newOrder?.paymentMethod?.toUpperCase()} • {newOrder?.deliveryLocality}
          </Text>

          <View style={styles.modalItems}>
            {newOrder?.items.map((item, i) => (
              <Text key={i} style={styles.modalItem}>
                {item.productName} × {item.quantity}
                {'  '}₹{Math.round(item.unitPrice / 100)}
              </Text>
            ))}
          </View>

          <TouchableOpacity
            style={styles.acceptBtn}
            onPress={handleAccept}
            disabled={actionLoad}
          >
            {actionLoad
              ? <ActivityIndicator color={Colors.white} />
              : <Text style={styles.acceptBtnText}>✅ ACCEPT KAREIN</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.rejectBtn}
            onPress={() => setShowReject(true)}
            disabled={actionLoad}
          >
            <Text style={styles.rejectBtnText}>❌ Reject Karein</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Reject reason sheet */}
      <Modal visible={showReject} transparent animationType="slide">
        <View style={styles.reasonOverlay}>
          <View style={styles.reasonSheet}>
            <Text style={styles.reasonTitle}>Reject Kyun?</Text>
            {REJECT_REASONS.map((reason) => (
              <TouchableOpacity
                key={reason}
                style={styles.reasonBtn}
                onPress={() => void handleReject(reason)}
              >
                <Text style={styles.reasonText}>{reason}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => setShowReject(false)} style={styles.reasonCancel}>
              <Text style={styles.reasonCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingTop: 56, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md,
    backgroundColor: Colors.primary,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.white, flex: 1 },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.success },
  empty:     { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.lg },
  emptyEmoji: { fontSize: 64 },
  emptyText:  { fontSize: FontSize.lg, color: Colors.textMuted },
  orderCard: {
    backgroundColor: Colors.card, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.sm, ...Shadow.card,
  },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  orderId:     { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  orderStatus: { fontSize: FontSize.sm, color: Colors.success, fontWeight: '600' },
  orderItem:   { fontSize: FontSize.md, color: Colors.text },
  orderTotal:  { fontSize: FontSize.sm, color: Colors.textLight, marginTop: 4 },
  actionRow:   { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  prepBtn:  { flex: 1, backgroundColor: Colors.warning, borderRadius: Radius.md, padding: Spacing.md, alignItems: 'center' },
  prepBtnText: { color: Colors.white, fontWeight: '700' },
  readyBtn: { flex: 1, backgroundColor: Colors.success, borderRadius: Radius.md, padding: Spacing.md, alignItems: 'center' },
  readyBtnText: { color: Colors.white, fontWeight: '700' },

  // New order modal
  modalContainer: {
    flex: 1, backgroundColor: Colors.newOrder,
    justifyContent: 'center', alignItems: 'center',
    padding: Spacing.xl, gap: Spacing.xl,
  },
  modalTitle:  { fontSize: FontSize.xxl, fontWeight: '900', color: Colors.white },
  modalAmount: { fontSize: FontSize.huge, fontWeight: '900', color: Colors.white },
  modalMeta:   { fontSize: FontSize.lg, color: 'rgba(255,255,255,0.8)' },
  modalItems:  { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: Radius.lg, padding: Spacing.lg, width: '100%', gap: Spacing.sm },
  modalItem:   { fontSize: FontSize.lg, color: Colors.white, fontWeight: '600' },
  acceptBtn:   { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.xl, width: '100%', alignItems: 'center' },
  acceptBtnText: { fontSize: FontSize.xl, fontWeight: '900', color: Colors.newOrder },
  rejectBtn:   { borderWidth: 2, borderColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, width: '100%', alignItems: 'center' },
  rejectBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '700' },

  // Reject reason sheet
  reasonOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  reasonSheet:   { backgroundColor: Colors.white, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.xl, gap: Spacing.md },
  reasonTitle:   { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  reasonBtn:     { backgroundColor: Colors.background, borderRadius: Radius.md, padding: Spacing.lg },
  reasonText:    { fontSize: FontSize.md, color: Colors.text },
  reasonCancel:  { alignItems: 'center', padding: Spacing.md },
  reasonCancelText: { color: Colors.textMuted, fontSize: FontSize.md },
});
