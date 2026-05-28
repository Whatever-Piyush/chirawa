import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  RefreshControl,
  ActivityIndicator,
  Animated,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Colors, FontSize, FontWeight, MIN_TAP, Radius, Shadow, Spacing } from '../../theme';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';
import { useToast } from '../../components/ui';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'MainTabs'> };

const PAGE_SIZE = 20;

// Local types — the API client's OrderDetailResponse doesn't match the actual
// /orders raw Prisma response, so we narrow to just the fields the list view
// actually reads.
interface OrderListItem {
  id:        string;
  shopId:    string;
  status:    string; // OrderStatus enum value as string
  total:     number; // paise
  createdAt: string;
  items: { productName: string; quantity: number; unitPrice: number }[];
  rating?:        number | null;
  ratingComment?: string | null;
  ratedAt?:       string | null;
}

interface ShopLite {
  id:   string;
  name: string;
}

interface FullOrderItem {
  productId: string;
  quantity:  number;
}

// Statuses that should NOT show the Track button
const FINAL_STATUSES = new Set(['delivered', 'cancelled']);

// Statuses where the customer can still cancel (must match backend)
const CANCELLABLE_STATUSES = new Set(['pending_payment', 'paid']);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso: string): string {
  const d = new Date(iso);
  let hour = d.getHours();
  const min = String(d.getMinutes()).padStart(2, '0');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${hour}:${min} ${ampm}`;
}

function statusPalette(status: string): { bg: string; fg: string } {
  if (status === 'delivered') return { bg: '#E8F5E9', fg: Colors.success };
  if (status === 'cancelled') return { bg: '#FDECEC', fg: Colors.error };
  return { bg: '#FFF4E5', fg: Colors.warning };
}

function statusLabel(status: string, t: (k: string) => string): string {
  if (status === 'delivered') return t('history.statusDelivered');
  if (status === 'cancelled') return t('history.statusCancelled');
  return t('history.statusActive');
}

// ─── Skeleton card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1,   duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 600, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View style={[styles.card, { opacity }]}>
      <View style={[styles.skeletonLine, { width: '60%' }]} />
      <View style={[styles.skeletonLine, { width: '40%', marginTop: 8 }]} />
      <View style={[styles.skeletonLine, { width: '35%', marginTop: 8 }]} />
      <View style={[styles.skeletonLine, { width: '90%', height: 36, marginTop: 12 }]} />
    </Animated.View>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onShopNow, t }: { onShopNow: () => void; t: (k: string) => string }) {
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyEmoji}>🛍️</Text>
      <Text style={styles.emptyTitle}>{t('history.empty')}</Text>
      <Text style={styles.emptyHint}>{t('history.emptyHint')}</Text>
      <TouchableOpacity style={styles.shopNowBtn} onPress={onShopNow} activeOpacity={0.8}>
        <Text style={styles.shopNowText}>{t('cart.shopNow')}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function OrderHistoryScreen({ navigation }: Props) {
  const t = useT();
  const toast = useToast();

  const [orders,      setOrders]      = useState<OrderListItem[]>([]);
  const [shopMap,     setShopMap]     = useState<Map<string, string>>(new Map());
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [error,       setError]       = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // ─── Header ────────────────────────────────────────────────────────────────

  useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: t('history.title') });
  }, [navigation, t]);

  // ─── Load data (orders + shops in parallel) ────────────────────────────────

  const loadData = useCallback(async () => {
    setError(false);
    try {
      const [ordersRaw, shopsRaw] = await Promise.all([
        api.getMyOrders({ page: 1, limit: PAGE_SIZE }) as unknown as Promise<OrderListItem[]>,
        api.getShops() as Promise<ShopLite[]>,
      ]);
      setOrders(ordersRaw);
      setShopMap(new Map(shopsRaw.map((s) => [s.id, s.name])));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleRetry = useCallback(() => {
    setError(false);
    setLoading(true);
    void loadData();
  }, [loadData]);

  // ─── Pull-to-refresh ───────────────────────────────────────────────────────

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setVisibleCount(PAGE_SIZE);
    void loadData();
  }, [loadData]);

  // ─── Infinite scroll ───────────────────────────────────────────────────────

  const handleLoadMore = useCallback(() => {
    setVisibleCount((c) => (c < orders.length ? Math.min(c + PAGE_SIZE, orders.length) : c));
  }, [orders.length]);

  // ─── Reorder ───────────────────────────────────────────────────────────────

  const handleReorder = useCallback((orderId: string) => {
    Alert.alert(
      t('history.reorderConfirm'),
      t('history.reorderReplace'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          onPress: async () => {
            setReorderingId(orderId);
            try {
              const full = await api.getOrder(orderId) as unknown as { items: FullOrderItem[] };
              // Clear the current cart so we don't trip the single-shop rule
              await api.clearCart().catch(() => undefined);
              for (const item of full.items) {
                await api.addToCart({ productId: item.productId, quantity: item.quantity });
              }
              navigation.navigate('Cart');
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : t('common.error');
              Alert.alert(t('common.error'), msg);
            } finally {
              setReorderingId(null);
            }
          },
        },
      ],
    );
  }, [navigation, t]);

  // ─── Render single order card ──────────────────────────────────────────────

  const renderOrder = useCallback(({ item }: { item: OrderListItem }) => {
    const palette       = statusPalette(item.status);
    const label         = statusLabel(item.status, t);
    const shopName      = shopMap.get(item.shopId) ?? t('history.shop');
    const itemCount     = item.items.reduce((sum, i) => sum + i.quantity, 0);
    const totalRupees   = Math.round(item.total / 100);
    const orderRef      = `#${item.id.slice(-6).toUpperCase()}`;
    const trackable     = !FINAL_STATUSES.has(item.status);
    const isReordering  = reorderingId === item.id;

    return (
      <View style={styles.card}>
        {/* Top row: shop name + status badge */}
        <View style={styles.cardTopRow}>
          <Text style={styles.shopName} numberOfLines={1}>🏪 {shopName}</Text>
          <View style={[styles.statusBadge, { backgroundColor: palette.bg }]}>
            <Text style={[styles.statusBadgeText, { color: palette.fg }]}>{label}</Text>
          </View>
        </View>

        {/* Meta row: order ID + date */}
        <Text style={styles.metaText}>
          {orderRef}  ·  {formatDate(item.createdAt)}
        </Text>

        {/* Item count + total */}
        <Text style={styles.summaryText}>
          {itemCount} {t('history.items')}  ·  <Text style={styles.totalText}>₹{totalRupees}</Text>
        </Text>

        {/* Rating row — only on delivered orders */}
        {item.status === 'delivered' && (
          item.rating && item.rating > 0 ? (
            <Text style={styles.ratingStars}>{'⭐'.repeat(item.rating)}</Text>
          ) : (
            <TouchableOpacity
              onPress={() => navigation.navigate('OrderTracking', { orderId: item.id })}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              style={styles.rateLink}
            >
              <Text style={styles.rateLinkText}>{t('rating.giveRating')}</Text>
            </TouchableOpacity>
          )
        )}

        {/* Buttons */}
        <View style={styles.btnRow}>
          {trackable && (
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary]}
              onPress={() => navigation.navigate('OrderTracking', { orderId: item.id })}
              activeOpacity={0.8}
            >
              <Text style={styles.btnSecondaryText}>📍  {t('history.track')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, isReordering && styles.btnDisabled]}
            onPress={() => handleReorder(item.id)}
            disabled={isReordering}
            activeOpacity={0.8}
          >
            {isReordering ? (
              <ActivityIndicator color={Colors.white} size="small" />
            ) : (
              <Text style={styles.btnPrimaryText}>🔁  {t('history.reorder')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [shopMap, t, reorderingId, navigation, handleReorder]);

  // ─── Render: loading skeleton ──────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.container}>
        {[1, 2, 3].map((k) => <SkeletonCard key={k} />)}
      </View>
    );
  }

  // ─── Render: error state ───────────────────────────────────────────────────

  if (error && orders.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorEmoji}>😕</Text>
          <Text style={styles.errorTitle}>इंटरनेट नहीं है</Text>
          <Text style={styles.errorSubtext}>कनेक्शन चेक करें और दोबारा कोशिश करें</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={handleRetry}
            activeOpacity={0.8}
          >
            <Text style={styles.retryText}>🔄 दोबारा कोशिश करें</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Render: empty state ───────────────────────────────────────────────────

  if (orders.length === 0) {
    return (
      <View style={styles.container}>
        <EmptyState onShopNow={() => navigation.navigate('MainTabs')} t={t} />
      </View>
    );
  }

  // ─── Render: list ──────────────────────────────────────────────────────────

  const visibleOrders = orders.slice(0, visibleCount);
  const hasMore       = visibleCount < orders.length;

  return (
    <FlatList
      data={visibleOrders}
      keyExtractor={(item) => item.id}
      renderItem={renderOrder}
      contentContainerStyle={styles.listContent}
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          colors={[Colors.primary]}
          tintColor={Colors.primary}
        />
      }
      onEndReached={handleLoadMore}
      onEndReachedThreshold={0.4}
      ListFooterComponent={hasMore ? (
        <View style={styles.footerLoader}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : null}
      showsVerticalScrollIndicator={false}
    />
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.background },
  listContent: { padding: Spacing.lg, gap: Spacing.md },

  // Card
  card: {
    backgroundColor: Colors.card, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.xs, ...Shadow.card,
  },
  cardTopRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    gap: Spacing.sm,
  },
  shopName: { flex: 1, fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  statusBadge: {
    paddingHorizontal: Spacing.md, paddingVertical: 4,
    borderRadius: Radius.full,
  },
  statusBadgeText: { fontSize: FontSize.xs, fontWeight: '700' },
  metaText:    { fontSize: FontSize.sm, color: Colors.textMuted },
  summaryText: { fontSize: FontSize.md, color: Colors.textLight, marginTop: 2 },
  totalText:   { color: Colors.primary, fontWeight: '800' },

  // Buttons
  btnRow: {
    flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm,
  },
  btn: {
    flex: 1, minHeight: MIN_TAP, justifyContent: 'center', alignItems: 'center',
    borderRadius: Radius.md, paddingHorizontal: Spacing.md,
  },
  btnPrimary:        { backgroundColor: Colors.primary },
  btnPrimaryText:    { color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },
  btnSecondary: {
    backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.primary,
  },
  btnSecondaryText:  { color: Colors.primary, fontSize: FontSize.md, fontWeight: '700' },
  btnDisabled:       { backgroundColor: Colors.disabled },

  // Rating row (delivered orders)
  ratingStars: { fontSize: 14, marginTop: 2 },
  rateLink:    { alignSelf: 'flex-start', marginTop: 2 },
  rateLinkText:{ fontSize: FontSize.sm, color: Colors.primary, fontWeight: '700' },

  // Footer loader
  footerLoader: { paddingVertical: Spacing.lg, alignItems: 'center' },

  // Skeleton
  skeletonLine: { height: 14, backgroundColor: Colors.border, borderRadius: Radius.sm },

  // Empty state
  emptyContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    gap: Spacing.md, paddingHorizontal: Spacing.xxl,
  },
  emptyEmoji: { fontSize: 80 },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptyHint:  { fontSize: FontSize.md, color: Colors.textLight, textAlign: 'center' },
  shopNowBtn: {
    marginTop: Spacing.md, backgroundColor: Colors.primary, borderRadius: Radius.full,
    paddingHorizontal: Spacing.xxl, paddingVertical: Spacing.md,
    minHeight: MIN_TAP, justifyContent: 'center', alignItems: 'center',
  },
  shopNowText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },

  // Error state
  errorContainer: {
    flex:              1,
    justifyContent:    'center',
    alignItems:        'center',
    padding:           32,
    gap:               12,
  },
  errorEmoji: {
    fontSize:           64,
    lineHeight:         90,
    includeFontPadding: false,
  },
  errorTitle: {
    fontSize:   FontSize.xl,
    fontWeight: '700',
    color:      Colors.text,
    textAlign:  'center',
  },
  errorSubtext: {
    fontSize:  FontSize.md,
    color:     Colors.textLight,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor:   Colors.primary,
    paddingHorizontal: 32,
    paddingVertical:   14,
    borderRadius:      Radius.full,
    marginTop:         8,
    minHeight:         MIN_TAP,
    justifyContent:    'center',
    alignItems:        'center',
  },
  retryText: {
    color:      Colors.white,
    fontWeight: '700',
    fontSize:   FontSize.md,
  },
});
