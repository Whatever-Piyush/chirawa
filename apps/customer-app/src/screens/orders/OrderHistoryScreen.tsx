import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import type { AddressResponse } from '@chirawa/types';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { FontSize, MIN_TAP, Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { api } from '../../services/api.service';
import { fetchProducts, toProductCard } from '../../services/catalog';
import { useT } from '@chirawa/i18n';
import { useAuth } from '../../context/AuthContext';
import ProductCard, { type ProductCardData } from '../../components/product/ProductCard';
import BringlyBag from '../../components/illustrations/BringlyBag';
import Header from '../home/Header';
import SearchBar from '../home/SearchBar';
import ClosedBanner from '../home/ClosedBanner';
import { useStoreClosed } from '../../hooks/useStoreClosed';
import LocationSheet from '../../components/location/LocationSheet';

// Rotating pastel placeholders for re-order product thumbnails (no images yet).
const REORDER_TILE_COLORS = ['#FFF0E9', '#E8F5E9', '#FFF0F5', '#EDE7F6', '#FFF8E1', '#E6F7F4'];

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
  items: { productId: string; productName: string; quantity: number; unitPrice: number }[];
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

function statusPalette(status: string, c: ColorPalette): { bg: string; fg: string } {
  if (status === 'delivered') return { bg: '#E8F5E9', fg: c.success };
  if (status === 'cancelled') return { bg: '#FDECEC', fg: c.error };
  return { bg: '#FFF4E5', fg: c.warning };
}

function statusLabel(status: string, t: (k: string) => string): string {
  if (status === 'delivered') return t('history.statusDelivered');
  if (status === 'cancelled') return t('history.statusCancelled');
  return t('history.statusActive');
}

// ─── Skeleton card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
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

// ─── Hero illustration card ("Reordering will be easy") ────────────────────────
// Cream-on-orange card matching the reference, but in Bringly's warm palette.
// The grocery bag is composed from icon + emoji produce so it needs no asset.

function ReorderHero({ t }: { t: (k: string) => string }) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  return (
    <View style={styles.hero}>
      <BringlyBag size={132} />
      <Text style={styles.heroTitle}>{t('history.reorderEmptyTitle')}</Text>
      <Text style={styles.heroSub}>{t('history.reorderEmptySub')}</Text>
    </View>
  );
}

// ─── Big faded footer tagline ("Chirawa's last minute app ❤️") ─────────────────

function TaglineFooter({ t }: { t: (k: string) => string }) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  return (
    <View style={styles.tagline}>
      <Text style={styles.taglineText}>
        {t('history.lastMinuteApp')} <Text style={styles.taglineHeart}>❤️</Text>
      </Text>
      <View style={styles.taglineRule} />
      <Text style={styles.taglineMark}>chirawa</Text>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function OrderHistoryScreen({ navigation }: Props) {
  const t = useT();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const { state } = useAuth();
  const closed = useStoreClosed();

  const [orders,      setOrders]      = useState<OrderListItem[]>([]);
  const [shopMap,     setShopMap]     = useState<Map<string, string>>(new Map());
  const [bestsellers, setBestsellers] = useState<ProductCardData[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [error,       setError]       = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [reorderingId, setReorderingId] = useState<string | null>(null);

  // Delivery address shown in the header + edited via the location sheet.
  const [addresses, setAddresses] = useState<AddressResponse[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const headerOpacity = useRef(new Animated.Value(0)).current;

  // ─── Header ────────────────────────────────────────────────────────────────

  useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: t('history.title') });
  }, [navigation, t]);

  useEffect(() => {
    Animated.timing(headerOpacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [headerOpacity]);

  const loadAddresses = useCallback(async () => {
    try {
      const data = await api.getAddresses();
      data.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      setAddresses(data);
    } catch {
      /* tolerate — header falls back to "Set your delivery location" */
    }
  }, []);

  useEffect(() => { void loadAddresses(); }, [loadAddresses]);
  useEffect(
    () => navigation.addListener('focus', () => { void loadAddresses(); }),
    [navigation, loadAddresses],
  );

  const activeAddress = addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
  const addressLine = activeAddress
    ? `${activeAddress.street}, ${activeAddress.locality}`
    : null;

  // ─── Load data (orders + shops + bestsellers in parallel) ──────────────────

  const loadData = useCallback(async () => {
    setError(false);
    try {
      const [ordersRaw, shopsRaw, productsRaw] = await Promise.all([
        api.getMyOrders({ page: 1, limit: PAGE_SIZE }) as unknown as Promise<OrderListItem[]>,
        api.getShops() as Promise<ShopLite[]>,
        fetchProducts({ limit: 10 }).catch(() => []),
      ]);
      setOrders(ordersRaw);
      setShopMap(new Map(shopsRaw.map((s) => [s.id, s.name])));
      setBestsellers(productsRaw.map(toProductCard));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // ─── "Order Again" products — dedup items across orders (newest first) ───────
  const reorderProducts = useMemo<ProductCardData[]>(() => {
    const seen = new Set<string>();
    const out: ProductCardData[] = [];
    for (const order of orders) {
      for (const it of order.items) {
        if (!it.productId || seen.has(it.productId)) continue;
        seen.add(it.productId);
        out.push({
          productId:  it.productId,
          name:       it.productName,
          pricePaise: it.unitPrice,
          imageColor: REORDER_TILE_COLORS[out.length % REORDER_TILE_COLORS.length],
        });
        if (out.length >= 10) return out;   // keep the strip focused
      }
    }
    return out;
  }, [orders]);

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
              navigation.navigate('Checkout');
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
    const palette       = statusPalette(item.status, Colors);
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
  }, [Colors, styles, shopMap, t, reorderingId, navigation, handleReorder]);

  // ─── Body: skeleton / error / list ───────────────────────────
  // Hero/order-again grid + bestsellers live in the list header; past orders are
  // the (possibly empty) virtualised list; the faded tagline is the footer. We
  // never early-return on empty so the hero + bestsellers always greet the user.

  const visibleOrders = orders.slice(0, visibleCount);
  const hasMore       = visibleCount < orders.length;

  const renderBody = () => {
    if (loading) {
      return (
        <View style={styles.bodyPad}>
          {[1, 2, 3].map((k) => <SkeletonCard key={k} />)}
        </View>
      );
    }

    if (error && orders.length === 0) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorEmoji}>😕</Text>
          <Text style={styles.errorTitle}>इंटरनेट नहीं है</Text>
          <Text style={styles.errorSubtext}>कनेक्शन चेक करें और दोबारा कोशिश करें</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry} activeOpacity={0.8}>
            <Text style={styles.retryText}>🔄 दोबारा कोशिश करें</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <FlatList
        data={visibleOrders}
        keyExtractor={(item) => item.id}
        renderItem={renderOrder}
        ListHeaderComponent={
          <View>
            {/* Order-again grid when the user has history; hero card otherwise */}
            {reorderProducts.length > 0 ? (
              <View style={styles.grid}>
                {reorderProducts.map((p) => (
                  <ProductCard key={p.productId} product={p} size="compact" />
                ))}
              </View>
            ) : (
              <ReorderHero t={t} />
            )}

            {/* Bestsellers — real products, compact 3-up grid */}
            {bestsellers.length > 0 && (
              <>
                <Text style={styles.sectionHeading}>{t('history.bestsellers')}</Text>
                <View style={styles.grid}>
                  {bestsellers.map((p) => (
                    <ProductCard key={p.productId} product={p} size="compact" />
                  ))}
                </View>
              </>
            )}

            {orders.length > 0 && (
              <Text style={styles.sectionHeading}>{t('history.pastOrders')}</Text>
            )}
          </View>
        }
        ListFooterComponent={
          <View>
            {hasMore && (
              <View style={styles.footerLoader}>
                <ActivityIndicator color={Colors.primary} />
              </View>
            )}
            <TaglineFooter t={t} />
          </View>
        }
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
        showsVerticalScrollIndicator={false}
      />
    );
  };

  return (
    <View style={styles.container}>
      {/* Same delivery-ETA + address header as Home / Categories */}
      <Header
        entranceOpacity={headerOpacity}
        addressLine={addressLine}
        night={closed}
        onProfilePress={() => navigation.navigate('MainTabs', { screen: 'Profile' })}
        onLocationPress={() => setSheetOpen(true)}
      />

      {/* Sticky search bar — straddles the orange/cream boundary */}
      <View style={styles.searchOverlap}>
        <SearchBar
          entranceOpacity={headerOpacity}
          onPress={() => navigation.navigate('Search')}
        />
      </View>

      {closed && <ClosedBanner />}

      {renderBody()}

      <LocationSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        addresses={addresses}
        userName={state.name}
        userPhone={state.phone}
        onChanged={loadAddresses}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.background },
  listContent: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.huge },

  // Sticky search straddles the orange header bottom (matches Home / Categories).
  searchOverlap: { marginTop: -20 },
  bodyPad:       { padding: Spacing.lg, gap: Spacing.md },

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

  // Section headings + grids
  sectionHeading: {
    fontSize: FontSize.xl, fontWeight: '800', color: Colors.textPrimary,
    marginTop: Spacing.lg, marginBottom: Spacing.md,
  },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: Spacing.sm,
  },
  bestsellerRow: { gap: 12, paddingRight: Spacing.lg, paddingBottom: Spacing.xs },

  // Hero card ("Reordering will be easy")
  hero: {
    backgroundColor: Colors.primaryLight,
    borderRadius:    Radius.xl,
    paddingVertical: Spacing.xxl,
    paddingHorizontal: Spacing.xl,
    alignItems:      'center',
    gap:             Spacing.xs,
    marginBottom:    Spacing.sm,
  },
  heroTitle: {
    fontSize: FontSize.xl, fontWeight: '800', color: Colors.textPrimary,
    textAlign: 'center', marginTop: Spacing.md,
  },
  heroSub: {
    fontSize: FontSize.sm, color: Colors.textSecondary,
    textAlign: 'center', lineHeight: 20,
  },

  // Big faded tagline footer ("Chirawa's last minute app ❤️")
  tagline: { marginTop: Spacing.xxl, paddingHorizontal: Spacing.xs },
  taglineText: {
    fontSize: FontSize.xxxl, lineHeight: 38, fontWeight: '800',
    color: Colors.primaryMid,
  },
  taglineHeart: { fontSize: FontSize.xxl },
  taglineRule: {
    height: 1, backgroundColor: Colors.border,
    marginTop: Spacing.lg, marginBottom: Spacing.md,
  },
  taglineMark: {
    fontSize: FontSize.xl, fontWeight: '800',
    color: Colors.border, letterSpacing: 1,
  },

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
