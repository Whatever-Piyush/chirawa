import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Shadow } from '../../theme';
import { useAuth } from '../../context/AuthContext';
import { RiderApi, type FoodPickup } from '../../services/api.service';

// ─── Rider food pickups (Food.md §12 Phase 6) ─────────────────────────────────
// Restaurant pickup flow over the food pipeline ONLY: ready orders appear here,
// a rider claims one (atomic server-side — first tap wins), then walks it
// through picked-up → out-for-delivery → delivered. Every food order is PREPAID
// (UPI) — there is never cash to collect. Marketplace delivery screens untouched.

const POLL_MS = 15_000;
const FOOD_ORANGE = '#E8590C';

export default function FoodPickupsScreen() {
  const { state } = useAuth();
  const insets = useSafeAreaInsets();
  const token = state.token;

  const [available, setAvailable] = useState<FoodPickup[]>([]);
  const [active, setActive]       = useState<FoodPickup[]>([]);
  const [loading, setLoading]     = useState(true);
  const [busyId, setBusyId]       = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setLoading(true);
    try {
      const res = await RiderApi.getFoodPickups(token);
      setAvailable(res.available);
      setActive(res.active);
    } catch {
      /* keep last list */
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    pollRef.current = setInterval(() => void load(true), POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  const act = useCallback(async (
    id: string,
    fn: (id: string, token: string) => Promise<unknown>,
  ) => {
    if (!token) return;
    setBusyId(id);
    try {
      await fn(id, token);
      await load(true);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Kuch galat ho gaya');
      await load(true); // e.g. "kisi aur rider ne le liya" → refresh the list
    } finally {
      setBusyId(null);
    }
  }, [token, load]);

  const renderPickup = useCallback(({ item }: { item: FoodPickup }) => {
    const busy   = busyId === item.id;
    const mine   = active.some((a) => a.id === item.id);
    const itemsLine = item.items.map((i) => `${i.quantity}× ${i.name}`).join(', ');

    return (
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.restaurant} numberOfLines={1}>🍽️ {item.restaurant.name}</Text>
          <View style={styles.paidPill}><Text style={styles.paidPillText}>PAID ✓</Text></View>
        </View>
        <Text style={styles.items} numberOfLines={2}>{itemsLine}</Text>
        <Text style={styles.meta}>📍 Pickup: {item.restaurant.address}</Text>
        {/* Full drop address arrives only after claiming (PII window) */}
        <Text style={styles.meta}>
          🏠 Drop: {item.deliveryStreet ? `${item.deliveryStreet}, ` : ''}{item.deliveryLocality}
        </Text>
        {mine && item.receiverName ? (
          <Text style={styles.meta}>👤 {item.receiverName}{item.receiverPhone ? ` · ${item.receiverPhone}` : ''}</Text>
        ) : null}
        <Text style={styles.amount}>₹{Math.round(item.totalPaise / 100)} — online paid, cash NahiN lena</Text>

        {busy ? (
          <ActivityIndicator color={FOOD_ORANGE} style={{ marginTop: 10 }} />
        ) : !mine ? (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: FOOD_ORANGE }]}
            onPress={() => void act(item.id, RiderApi.claimFoodPickup)}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>यह डिलीवरी लें</Text>
          </TouchableOpacity>
        ) : item.status === 'ready_for_pickup' ? (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: FOOD_ORANGE }]}
            onPress={() => void act(item.id, RiderApi.foodPickedUp)}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>✓ खाना उठा लिया</Text>
          </TouchableOpacity>
        ) : item.status === 'picked_up' ? (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#8E44AD' }]}
            onPress={() => void act(item.id, RiderApi.foodOutForDelivery)}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>🛵 डिलीवरी शुरू</Text>
          </TouchableOpacity>
        ) : item.status === 'out_for_delivery' ? (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: Colors.success }]}
            onPress={() => void act(item.id, RiderApi.foodDelivered)}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>✓ डिलीवर हो गया</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }, [busyId, active, act]);

  const sections: FoodPickup[] = [...active, ...available.filter((a) => !active.some((m) => m.id === a.id))];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🍔 Food Deliveries</Text>
        <Text style={styles.headerSub}>
          {active.length > 0
            ? `${active.length} active delivery`
            : `${available.length} pickup ready`}
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={FOOD_ORANGE} size="large" /></View>
      ) : sections.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🍽️</Text>
          <Text style={styles.emptyText}>अभी कोई food pickup ready नहीं</Text>
          <Text style={styles.emptyHint}>Restaurant ka khana ready hote hi yahan dikhega</Text>
        </View>
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(o) => o.id}
          renderItem={renderPickup}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={FOOD_ORANGE} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: Colors.text },
  headerSub: { fontSize: 12, color: Colors.textLight, marginTop: 2 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 42 },
  emptyText: { fontSize: 14, fontWeight: '600', color: Colors.text },
  emptyHint: { fontSize: 12, color: Colors.textLight, textAlign: 'center' },

  list: { padding: 16, paddingBottom: 90, gap: 12 },
  card: { backgroundColor: Colors.card, borderRadius: 14, padding: 14, ...Shadow.card },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  restaurant: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.text },
  paidPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: '#E8F5E9',
  },
  paidPillText: { fontSize: 10, fontWeight: '700', color: Colors.success },
  items: { fontSize: 12, color: Colors.textLight, marginTop: 6 },
  meta: { fontSize: 11, color: Colors.textMuted, marginTop: 4 },
  amount: { fontSize: 12, fontWeight: '600', color: Colors.success, marginTop: 6 },

  btn: {
    marginTop: 12, paddingVertical: 12, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  btnText: { color: Colors.white, fontSize: 14, fontWeight: '700' },
});
