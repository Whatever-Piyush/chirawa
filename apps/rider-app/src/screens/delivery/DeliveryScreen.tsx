import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Linking, ScrollView, RefreshControl,
} from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { Colors, Spacing, FontSize, Radius, Shadow } from '../../theme';
import { RiderApi } from '../../services/api.service';
import { useAuth } from '../../context/AuthContext';
import { useRiderLocationPublisher } from '../../hooks/useRiderLocationPublisher';
import { DEV_HOST } from '../../config/devHost';

const SOCKET_URL = __DEV__ ? `http://${DEV_HOST}:3000` : 'https://api.chirawa.in';

interface Stop {
  id: string; status: string; paymentMethod: string; totalAmount: number;
  shop: { name: string; address: string; lat: number; lng: number };
  items: Array<{ productName: string; quantity: number }>;
  deliveryStreet: string; deliveryLandmark: string; deliveryLocality: string;
  deliveryLat: number; deliveryLng: number;
  receiverName: string; receiverPhone: string;
}
interface ActiveBatch {
  batchId: string | null; orderCount: number; allPickedUp: boolean; orders: Stop[];
}

const PICKED = ['picked_up', 'out_for_delivery', 'delivered'];

function navigate(lat: number, lng: number) {
  void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
}

export default function DeliveryScreen() {
  const { state }                 = useAuth();
  const [batch,   setBatch]       = useState<ActiveBatch | null>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting,  setActing]      = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Publish rider:location for every live order in the batch (Milestone R1).
  // Non-blocking: a denied permission only shows the banner below.
  const { locationBlocked } = useRiderLocationPublisher(socketRef, batch?.orders ?? []);
  const [locBannerDismissed, setLocBannerDismissed] = useState(false);
  useEffect(() => { if (!locationBlocked) setLocBannerDismissed(false); }, [locationBlocked]);

  const load = useCallback(async () => {
    if (!state.token) return;
    try {
      const data = await RiderApi.getActiveDelivery(state.token) as ActiveBatch | null;
      setBatch(data && data.orders?.length ? data : null);
    } catch { setBatch(null); }
    finally { setLoading(false); setRefreshing(false); }
  }, [state.token]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!state.token) return;
    const socket = io(SOCKET_URL, { auth: { token: state.token }, transports: ['websocket'] });
    socket.on('order:status', () => void load());
    socket.on('order:assigned', () => void load());
    socketRef.current = socket;
    return () => { socket.disconnect(); };
  }, [state.token, load]);

  async function act(stop: Stop, kind: 'pickup' | 'start' | 'deliver') {
    if (!state.token) return;
    setActing(stop.id);
    try {
      if (kind === 'pickup')      await RiderApi.pickup(stop.id, state.token);
      else if (kind === 'start')  await RiderApi.startDelivery(stop.id, state.token);
      else if (kind === 'deliver') {
        const confirmMsg = stop.paymentMethod === 'cod'
          ? `₹${Math.round(stop.totalAmount / 100)} cash collect karein`
          : 'Deliver mark karein?';
        await new Promise<void>((resolve) => {
          Alert.alert(stop.paymentMethod === 'cod' ? '💵 Cash Collect' : '✅ Deliver', confirmMsg, [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
            { text: 'Done', onPress: () => {
                void (async () => {
                  try {
                    // COD records the cash; prepaid uses the delivered endpoint (0.1).
                    if (stop.paymentMethod === 'cod') await RiderApi.collectCod(stop.id, stop.totalAmount, state.token!);
                    else                              await RiderApi.markDelivered(stop.id, state.token!);
                  } catch (e: unknown) {
                    Alert.alert('Error', e instanceof Error ? e.message : 'Action fail hua');
                  } finally {
                    resolve();
                  }
                })();
              } },
          ]);
        });
      }
      await load();
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Action fail hua');
    } finally {
      setActing(null);
    }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} size="large" /></View>;

  if (!batch) {
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

  const pickups  = batch.orders.filter((o) => !PICKED.includes(o.status));
  const dropoffs = batch.orders.filter((o) => PICKED.includes(o.status));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Active Delivery</Text>
        {batch.orderCount > 1 && <Text style={styles.batchTag}>📦 {batch.orderCount} orders</Text>}
      </View>

      {/* Location-permission banner — informational only, never blocks actions */}
      {locationBlocked && !locBannerDismissed && (
        <TouchableOpacity style={styles.locBanner} onPress={() => void Linking.openSettings()} activeOpacity={0.85}>
          <Text style={styles.locBannerText}>📍 Location on karo — customer ko map pe dikhega</Text>
          <TouchableOpacity onPress={() => setLocBannerDismissed(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.locBannerClose}>✕</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={Colors.primary} />}
      >
        {/* PICKUPS */}
        {pickups.length > 0 && <Text style={styles.groupTitle}>🏪 Pickup ({pickups.length})</Text>}
        {pickups.map((o) => (
          <View key={o.id} style={styles.card}>
            <Text style={styles.shopName}>{o.shop.name}</Text>
            <Text style={styles.addr}>{o.shop.address}</Text>
            {o.items.map((it, i) => <Text key={i} style={styles.item}>• {it.productName} × {it.quantity}</Text>)}
            <TouchableOpacity style={styles.navBtn} onPress={() => navigate(o.shop.lat, o.shop.lng)}>
              <Text style={styles.navBtnText}>🗺 Navigate to Shop</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={() => void act(o, 'pickup')} disabled={acting === o.id}>
              {acting === o.id ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.actionBtnText}>Order Uthaa Liya</Text>}
            </TouchableOpacity>
          </View>
        ))}

        {/* DROPOFFS */}
        {dropoffs.length > 0 && <Text style={styles.groupTitle}>🏠 Deliver ({dropoffs.length})</Text>}
        {dropoffs.map((o) => (
          <View key={o.id} style={styles.card}>
            <Text style={styles.shopName}>{o.deliveryStreet}</Text>
            <Text style={styles.addr}>{o.deliveryLandmark} · {o.deliveryLocality}</Text>
            <Text style={styles.amount}>₹{Math.round(o.totalAmount / 100)} {o.paymentMethod === 'cod' ? '· 💵 COD' : '· 💳 Online'}</Text>
            {o.receiverName ? (
              <View style={styles.contactRow}>
                <Text style={styles.contactName} numberOfLines={1}>👤 {o.receiverName}</Text>
                {o.receiverPhone ? (
                  <TouchableOpacity style={styles.callBtn} onPress={() => void Linking.openURL(`tel:${o.receiverPhone}`)}>
                    <Text style={styles.callBtnText}>📞 Call</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
            <TouchableOpacity style={styles.navBtn} onPress={() => navigate(o.deliveryLat, o.deliveryLng)}>
              <Text style={styles.navBtnText}>🗺 Navigate to Customer</Text>
            </TouchableOpacity>
            {o.status === 'delivered' ? (
              <View style={styles.doneBanner}><Text style={styles.doneText}>✅ Delivered</Text></View>
            ) : o.status === 'out_for_delivery' ? (
              <TouchableOpacity style={styles.actionBtn} onPress={() => void act(o, 'deliver')} disabled={acting === o.id}>
                {acting === o.id ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.actionBtnText}>Deliver Kar Diya</Text>}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.actionBtn, !batch.allPickedUp && styles.actionBtnDisabled]}
                onPress={() => void act(o, 'start')}
                disabled={acting === o.id || !batch.allPickedUp}
              >
                {acting === o.id ? <ActivityIndicator color={Colors.white} />
                  : <Text style={styles.actionBtnText}>{batch.allPickedUp ? 'Delivery Shuru' : 'Pehle sab pickup karein'}</Text>}
              </TouchableOpacity>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 56, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md, backgroundColor: Colors.primary },
  headerTitle: { flex: 1, fontSize: FontSize.xl, fontWeight: '800', color: Colors.white },
  batchTag: { fontSize: FontSize.md, color: Colors.white, fontWeight: '700' },
  empty:     { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.md },
  emptyEmoji: { fontSize: 64 },
  emptyText:  { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  emptySub:   { fontSize: FontSize.md, color: Colors.textMuted, textAlign: 'center' },
  locBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.warning, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
  },
  locBannerText:  { flex: 1, color: Colors.white, fontSize: FontSize.sm, fontWeight: '700' },
  locBannerClose: { color: Colors.white, fontSize: FontSize.md, fontWeight: '900' },
  scroll: { padding: Spacing.lg, gap: Spacing.md },
  groupTitle: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text, marginTop: Spacing.sm },
  card:   { backgroundColor: Colors.card, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.xs, ...Shadow.card },
  shopName: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  addr:   { fontSize: FontSize.sm, color: Colors.textLight },
  item:   { fontSize: FontSize.sm, color: Colors.text },
  amount: { fontSize: FontSize.md, fontWeight: '800', color: Colors.primary, marginTop: 2 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  contactName: { flex: 1, fontSize: FontSize.sm, color: Colors.text, fontWeight: '700' },
  callBtn: { backgroundColor: Colors.success, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  callBtnText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: '800' },
  navBtn: { backgroundColor: Colors.background, borderRadius: Radius.md, padding: Spacing.sm, alignItems: 'center', marginTop: Spacing.sm },
  navBtnText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '700' },
  actionBtn: { backgroundColor: Colors.primary, borderRadius: Radius.md, padding: Spacing.md, alignItems: 'center', marginTop: Spacing.sm },
  actionBtnDisabled: { backgroundColor: Colors.textMuted },
  actionBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '900' },
  doneBanner: { backgroundColor: Colors.success, borderRadius: Radius.md, padding: Spacing.md, alignItems: 'center', marginTop: Spacing.sm },
  doneText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },
});
