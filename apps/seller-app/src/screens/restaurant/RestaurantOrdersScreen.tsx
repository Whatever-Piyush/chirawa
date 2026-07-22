import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Switch, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Shadow } from '../../theme';
import { useAuth } from '../../context/AuthContext';
import {
  SellerApi, type MyRestaurant, type RestaurantFoodOrder, type RestaurantMenuItem,
} from '../../services/api.service';

// ─── Restaurant Mode (Food.md §11.2) — inside the existing Seller App ─────────
// The restaurant's food-order queue: Accept · Reject · Mark Preparing · Mark
// Ready · Today's Orders · Order History. Reads ONLY the food pipeline
// (/food/restaurant/*) — the marketplace order queue screen is untouched.
// 15s polling (matches the app's existing refresh discipline; sockets later).

const POLL_MS = 15_000;
const FOOD_ORANGE = '#E8590C';

const STATUS_LABEL: Record<string, string> = {
  paid:             'नया ऑर्डर',
  confirmed:        'Accept हो गया',
  preparing:        'बन रहा है',
  ready_for_pickup: 'तैयार — राइडर का इंतज़ार',
  picked_up:        'राइडर ले गया',
  out_for_delivery: 'डिलीवरी पर',
  delivered:        'डिलीवर हो गया',
  cancelled:        'कैंसिल',
};

const STATUS_COLOR: Record<string, string> = {
  paid:             Colors.newOrder,
  confirmed:        Colors.warning,
  preparing:        FOOD_ORANGE,
  ready_for_pickup: '#2980B9',
  picked_up:        '#8E44AD',
  out_for_delivery: '#8E44AD',
  delivered:        Colors.success,
  cancelled:        Colors.textMuted,
};

function elapsedMinutes(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
}

export default function RestaurantOrdersScreen() {
  const { state } = useAuth();
  const insets = useSafeAreaInsets();
  const token = state.token;

  const [scope, setScope]           = useState<'today' | 'history' | 'menu'>('today');
  const [restaurant, setRestaurant] = useState<MyRestaurant | null>(null);
  const [orders, setOrders]         = useState<RestaurantFoodOrder[]>([]);
  const [menu, setMenu]             = useState<RestaurantMenuItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [busyId, setBusyId]         = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setLoading(true);
    try {
      if (scope === 'menu') {
        const res = await SellerApi.getRestaurantMenu(token);
        setRestaurant(res.restaurant);
        setMenu(res.items);
      } else {
        const res = await SellerApi.getRestaurantOrders(scope, token);
        setRestaurant(res.restaurant);
        setOrders(res.orders);
      }
    } catch {
      /* keep last list — transient errors must not blank the queue */
    } finally {
      setLoading(false);
    }
  }, [token, scope]);

  useEffect(() => {
    void load();
    // Poll only the live order queue — the menu view refreshes on demand.
    if (scope === 'menu') return;
    pollRef.current = setInterval(() => void load(true), POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load, scope]);

  // Open/close the restaurant (customer app shows Closed instantly on next read).
  const toggleOpen = useCallback(async (isOpen: boolean) => {
    if (!token || !restaurant) return;
    setRestaurant({ ...restaurant, isOpen }); // optimistic
    try {
      await SellerApi.setRestaurantOpen(isOpen, token);
    } catch (e: unknown) {
      setRestaurant({ ...restaurant, isOpen: !isOpen }); // revert
      Alert.alert('Error', e instanceof Error ? e.message : 'Kuch galat ho gaya');
    }
  }, [token, restaurant]);

  // Sold-out toggle for one menu item.
  const toggleItem = useCallback(async (item: RestaurantMenuItem, isAvailable: boolean) => {
    if (!token) return;
    setMenu((prev) => prev.map((m) => (m.id === item.id ? { ...m, isAvailable } : m))); // optimistic
    try {
      await SellerApi.setMenuItemAvailability(item.id, isAvailable, token);
    } catch (e: unknown) {
      setMenu((prev) => prev.map((m) => (m.id === item.id ? { ...m, isAvailable: !isAvailable } : m)));
      Alert.alert('Error', e instanceof Error ? e.message : 'Kuch galat ho gaya');
    }
  }, [token]);

  const act = useCallback(async (
    orderId: string,
    fn: (id: string, token: string) => Promise<unknown>,
  ) => {
    if (!token) return;
    setBusyId(orderId);
    try {
      await fn(orderId, token);
      await load(true);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Kuch galat ho gaya');
    } finally {
      setBusyId(null);
    }
  }, [token, load]);

  const confirmReject = useCallback((orderId: string) => {
    Alert.alert(
      'ऑर्डर reject करें?',
      'Customer ko poora paisa refund ho jayega.',
      [
        { text: 'नहीं', style: 'cancel' },
        {
          text: 'हां, reject करें', style: 'destructive',
          onPress: () => void act(orderId, (id, t) => SellerApi.rejectFoodOrder(id, 'restaurant_rejected', t)),
        },
      ],
    );
  }, [act]);

  const renderOrder = useCallback(({ item }: { item: RestaurantFoodOrder }) => {
    const busy = busyId === item.id;
    const mins = elapsedMinutes(item.createdAt);
    return (
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <View style={[styles.statusPill, { backgroundColor: STATUS_COLOR[item.status] ?? Colors.textMuted }]}>
            <Text style={styles.statusPillText}>{STATUS_LABEL[item.status] ?? item.status}</Text>
          </View>
          <Text style={styles.elapsed}>{mins} min पहले</Text>
        </View>

        {item.items.map((line) => (
          <View key={line.id} style={styles.lineRow}>
            <Text style={styles.lineQty}>{line.quantity}×</Text>
            <Text style={styles.lineName} numberOfLines={1}>{line.name}</Text>
            <Text style={styles.lineAmt}>₹{Math.round(line.subtotal / 100)}</Text>
          </View>
        ))}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total (items)</Text>
          <Text style={styles.totalAmt}>₹{Math.round(item.itemsSubtotalPaise / 100)}</Text>
        </View>
        <Text style={styles.meta}>
          📍 {item.deliveryLocality || 'Chirawa'}{item.receiverName ? `  ·  ${item.receiverName}` : ''}
        </Text>

        {/* Actions by status — the food state machine's restaurant hops */}
        {busy ? (
          <ActivityIndicator color={FOOD_ORANGE} style={styles.busy} />
        ) : item.status === 'paid' ? (
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.btn, styles.btnReject]}
              onPress={() => confirmReject(item.id)}
              activeOpacity={0.85}
            >
              <Text style={styles.btnRejectText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnAccept]}
              onPress={() => void act(item.id, SellerApi.acceptFoodOrder)}
              activeOpacity={0.85}
            >
              <Text style={styles.btnText}>✓ Accept</Text>
            </TouchableOpacity>
          </View>
        ) : item.status === 'confirmed' ? (
          <TouchableOpacity
            style={[styles.btn, styles.btnFull, { backgroundColor: FOOD_ORANGE }]}
            onPress={() => void act(item.id, SellerApi.markFoodPreparing)}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>🍳 खाना बनना शुरू</Text>
          </TouchableOpacity>
        ) : item.status === 'preparing' ? (
          <TouchableOpacity
            style={[styles.btn, styles.btnFull, { backgroundColor: Colors.success }]}
            onPress={() => void act(item.id, SellerApi.markFoodReady)}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>✓ तैयार है — राइडर बुलाएं</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }, [busyId, act, confirmReject]);

  const renderMenuItem = useCallback(({ item }: { item: RestaurantMenuItem }) => (
    <View style={styles.menuRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.menuName, !item.isAvailable && styles.menuNameOff]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.menuMeta}>
          {item.category} · ₹{Math.round(item.pricePaise / 100)}
        </Text>
      </View>
      <Text style={[styles.menuState, { color: item.isAvailable ? Colors.success : Colors.textMuted }]}>
        {item.isAvailable ? 'available' : 'sold out'}
      </Text>
      <Switch
        value={item.isAvailable}
        onValueChange={(v) => void toggleItem(item, v)}
        trackColor={{ true: '#F8C4A5', false: Colors.border }}
        thumbColor={item.isAvailable ? FOOD_ORANGE : Colors.textMuted}
      />
    </View>
  ), [toggleItem]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>🍽️ {restaurant?.name ?? 'Restaurant'}</Text>
          <Text style={styles.headerSub}>Food orders — Bringly Food</Text>
        </View>
        {/* Restaurant open/close — the self-serve kill switch */}
        {restaurant && (
          <View style={styles.openWrap}>
            <Text style={[styles.openLabel, { color: restaurant.isOpen ? Colors.success : Colors.error }]}>
              {restaurant.isOpen ? 'खुला है' : 'बंद है'}
            </Text>
            <Switch
              value={restaurant.isOpen}
              onValueChange={(v) => void toggleOpen(v)}
              trackColor={{ true: '#BFE8CB', false: Colors.border }}
              thumbColor={restaurant.isOpen ? Colors.success : Colors.error}
            />
          </View>
        )}
      </View>

      {/* Today / History / Menu toggle */}
      <View style={styles.toggleRow}>
        {(['today', 'history', 'menu'] as const).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.toggle, scope === s && styles.toggleActive]}
            onPress={() => setScope(s)}
            activeOpacity={0.85}
          >
            <Text style={[styles.toggleText, scope === s && styles.toggleTextActive]}>
              {s === 'today' ? 'आज के ऑर्डर' : s === 'history' ? 'History' : 'मेनू'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={FOOD_ORANGE} size="large" /></View>
      ) : scope === 'menu' ? (
        menu.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyEmoji}>📋</Text>
            <Text style={styles.emptyText}>Menu abhi upload nahi hua</Text>
          </View>
        ) : (
          <FlatList
            data={menu}
            keyExtractor={(m) => m.id}
            renderItem={renderMenuItem}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={FOOD_ORANGE} />
            }
          />
        )
      ) : orders.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🍽️</Text>
          <Text style={styles.emptyText}>
            {scope === 'today' ? 'आज अभी कोई food order नहीं' : 'अभी कोई order history नहीं'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          renderItem={renderOrder}
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
  header: {
    paddingHorizontal: 16, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: Colors.text },
  headerSub: { fontSize: 12, color: Colors.textLight, marginTop: 2 },
  openWrap: { alignItems: 'center', gap: 2 },
  openLabel: { fontSize: 10, fontWeight: '700' },

  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.card, borderRadius: 12, padding: 12,
    marginBottom: 8, ...Shadow.card,
  },
  menuName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  menuNameOff: { color: Colors.textMuted, textDecorationLine: 'line-through' },
  menuMeta: { fontSize: 11, color: Colors.textLight, marginTop: 2 },
  menuState: { fontSize: 10, fontWeight: '700', width: 58, textAlign: 'right' },

  toggleRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  toggle: {
    flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center',
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  toggleActive: { backgroundColor: FOOD_ORANGE, borderColor: FOOD_ORANGE },
  toggleText: { fontSize: 13, fontWeight: '600', color: Colors.textLight },
  toggleTextActive: { color: Colors.white },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyEmoji: { fontSize: 42 },
  emptyText: { fontSize: 14, color: Colors.textLight },

  list: { padding: 16, paddingBottom: 90, gap: 12 },
  card: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 14,
    ...Shadow.card,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { color: Colors.white, fontSize: 11, fontWeight: '700' },
  elapsed: { fontSize: 11, color: Colors.textMuted },

  lineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  lineQty: { width: 30, fontSize: 13, fontWeight: '700', color: FOOD_ORANGE },
  lineName: { flex: 1, fontSize: 13, color: Colors.text },
  lineAmt: { fontSize: 12, color: Colors.textLight, minWidth: 44, textAlign: 'right' },

  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: Colors.border,
    marginTop: 6, paddingTop: 8,
  },
  totalLabel: { fontSize: 13, color: Colors.textLight },
  totalAmt: { fontSize: 14, fontWeight: '700', color: Colors.text },
  meta: { fontSize: 11, color: Colors.textMuted, marginTop: 4 },

  busy: { marginTop: 10 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  btnFull: { marginTop: 12 },
  btnAccept: { backgroundColor: Colors.success },
  btnReject: { backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.error },
  btnText: { color: Colors.white, fontSize: 14, fontWeight: '700' },
  btnRejectText: { color: Colors.error, fontSize: 14, fontWeight: '700' },
});
