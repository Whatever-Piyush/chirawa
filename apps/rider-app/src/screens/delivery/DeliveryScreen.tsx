import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Linking,
} from 'react-native';
import * as Location from 'expo-location';
import { io, type Socket } from 'socket.io-client';
import { Colors, Spacing, FontSize, Radius, Shadow } from '../../theme';
import { RiderApi } from '../../services/api.service';
import { useAuth } from '../../context/AuthContext';
import { DEV_HOST } from '../../config/devHost';

const SOCKET_URL = __DEV__ ? `http://${DEV_HOST}:3000` : 'https://api.chirawa.in';

interface ActiveOrder {
  id: string; status: string; paymentMethod: string;
  totalAmount: number; deliveryLocality: string;
  shop: { name: string; address: string; lat: number; lng: number };
  items: Array<{ productName: string; quantity: number }>;
  deliveryLat: number; deliveryLng: number;
  deliveryStreet: string; deliveryLandmark: string;
}

const STEPS = [
  { key: 'confirmed',        label: 'Shop Pe Pahuncho',    action: 'Shop Pahunch Gaya' },
  { key: 'ready_for_pickup', label: 'Order Uthao',         action: 'Order Uthaa Liya' },
  { key: 'picked_up',        label: 'Delivery Shuru Karo', action: 'Delivery Shuru' },
  { key: 'out_for_delivery', label: 'Deliver Karo',        action: 'Deliver Kar Diya' },
];

export default function DeliveryScreen() {
  const { state }                 = useAuth();
  const [order,   setOrder]       = useState<ActiveOrder | null>(null);
  const [loading, setLoading]     = useState(true);
  const [acting,  setActing]      = useState(false);
  const socketRef = React.useRef<Socket | null>(null);
  const locRef    = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const loadActive = useCallback(async () => {
    if (!state.token) return;
    try {
      const data = await RiderApi.getActiveDelivery(state.token) as ActiveOrder | null;
      setOrder(data);
    } catch { setOrder(null); }
    finally { setLoading(false); }
  }, [state.token]);

  useEffect(() => { void loadActive(); }, [loadActive]);

  // Socket.io — receive status updates
  useEffect(() => {
    if (!state.token) return;
    const socket = io(SOCKET_URL, { auth: { token: state.token }, transports: ['websocket'] });
    socket.on('order:status', () => void loadActive());
    socketRef.current = socket;
    return () => socket.disconnect();
  }, [state.token, loadActive]);

  // Location push every 8 seconds when out_for_delivery
  useEffect(() => {
    if (order?.status !== 'out_for_delivery' || !state.token) return;

    void (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      locRef.current = setInterval(async () => {
        if (!socketRef.current || !order) return;
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          socketRef.current.emit('rider:location', {
            orderId:   order.id,
            lat:       loc.coords.latitude,
            lng:       loc.coords.longitude,
            timestamp: Date.now(),
          });
        } catch {}
      }, 8000);
    })();

    return () => { if (locRef.current) clearInterval(locRef.current); };
  }, [order?.status, order?.id, state.token]);

  async function handleAction(action: string) {
    if (!order || !state.token) return;
    setActing(true);
    try {
      if (action === 'pickup')         await RiderApi.pickup(order.id, state.token);
      else if (action === 'start')     await RiderApi.startDelivery(order.id, state.token);
      else if (action === 'delivered') {
        // COD collection
        if (order.paymentMethod === 'cod') {
          Alert.alert(
            '💵 Cash Collect Karein',
            `₹${Math.round(order.totalAmount / 100)} cash lena hai`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Cash Mila',
                onPress: async () => {
                  await RiderApi.collectCod(order.id, order.totalAmount, state.token!);
                  await loadActive();
                },
              },
            ],
          );
          setActing(false);
          return;
        }
        await RiderApi.collectCod(order.id, order.totalAmount, state.token);
      }
      await loadActive();
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Action failed');
    } finally {
      setActing(false);
    }
  }

  function openNavigation(lat: number, lng: number, label: string) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${label}`;
    void Linking.openURL(url);
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} size="large" /></View>;

  if (!order) {
    return (
      <View style={styles.container}>
        <View style={styles.header}><Text style={styles.headerTitle}>Active Delivery</Text></View>
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>😴</Text>
          <Text style={styles.emptyText}>Abhi koi delivery nahi</Text>
          <Text style={styles.emptySub}>Online raho aur orders ka intezaar karo</Text>
        </View>
      </View>
    );
  }

  const currentStep = STEPS.findIndex((s) => s.key === order.status);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Active Delivery</Text>
        <Text style={styles.headerStatus}>{order.paymentMethod === 'cod' ? '💵 COD' : '💳 Online'}</Text>
      </View>

      <View style={styles.orderCard}>
        {/* Shop info */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>📍 Pickup From</Text>
          <Text style={styles.shopName}>{order.shop.name}</Text>
          <Text style={styles.shopAddr}>{order.shop.address}</Text>
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => openNavigation(Number(order.shop.lat), Number(order.shop.lng), order.shop.name)}
          >
            <Text style={styles.navBtnText}>🗺 Navigate to Shop</Text>
          </TouchableOpacity>
        </View>

        {/* Delivery address */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>🏠 Deliver To</Text>
          <Text style={styles.shopName}>{order.deliveryStreet}</Text>
          <Text style={styles.shopAddr}>{order.deliveryLandmark}</Text>
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => openNavigation(Number(order.deliveryLat), Number(order.deliveryLng), order.deliveryLocality)}
          >
            <Text style={styles.navBtnText}>🗺 Navigate to Customer</Text>
          </TouchableOpacity>
        </View>

        {/* Items */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>📦 Items</Text>
          {order.items.map((item, i) => (
            <Text key={i} style={styles.itemText}>• {item.productName} × {item.quantity}</Text>
          ))}
          <Text style={styles.amountText}>₹{Math.round(order.totalAmount / 100)}</Text>
        </View>

        {/* Action button based on current status */}
        {currentStep >= 0 && currentStep < STEPS.length && (
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => {
              const actions = ['', 'pickup', 'start', 'delivered'];
              void handleAction(actions[currentStep + 1] ?? 'delivered');
            }}
            disabled={acting}
          >
            {acting
              ? <ActivityIndicator color={Colors.white} />
              : <Text style={styles.actionBtnText}>
                  {STEPS[currentStep]?.action ?? 'Next Step'}
                </Text>
            }
          </TouchableOpacity>
        )}

        {order.status === 'delivered' && (
          <View style={styles.deliveredBanner}>
            <Text style={styles.deliveredText}>✅ Delivered! Bahut badhiya!</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: 56, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md,
    backgroundColor: Colors.primary,
  },
  headerTitle:  { flex: 1, fontSize: FontSize.xl, fontWeight: '800', color: Colors.white },
  headerStatus: { fontSize: FontSize.md, color: 'rgba(255,255,255,0.8)', fontWeight: '600' },
  empty:     { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.md },
  emptyEmoji: { fontSize: 64 },
  emptyText:  { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  emptySub:   { fontSize: FontSize.md, color: Colors.textMuted, textAlign: 'center' },
  orderCard: { margin: Spacing.lg, gap: Spacing.md },
  section:   { backgroundColor: Colors.card, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm, ...Shadow.card },
  sectionLabel: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600', textTransform: 'uppercase' },
  shopName:  { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  shopAddr:  { fontSize: FontSize.sm, color: Colors.textLight },
  navBtn:    { backgroundColor: Colors.background, borderRadius: Radius.md, padding: Spacing.md, alignItems: 'center', marginTop: Spacing.sm },
  navBtnText: { fontSize: FontSize.md, color: Colors.primary, fontWeight: '600' },
  itemText:  { fontSize: FontSize.md, color: Colors.text },
  amountText: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.primary, marginTop: Spacing.sm },
  actionBtn: { backgroundColor: Colors.primary, borderRadius: Radius.lg, padding: Spacing.xl, alignItems: 'center' },
  actionBtnText: { color: Colors.white, fontSize: FontSize.xl, fontWeight: '900' },
  deliveredBanner: { backgroundColor: Colors.success, borderRadius: Radius.lg, padding: Spacing.xl, alignItems: 'center' },
  deliveredText:   { color: Colors.white, fontSize: FontSize.xl, fontWeight: '800' },
});
