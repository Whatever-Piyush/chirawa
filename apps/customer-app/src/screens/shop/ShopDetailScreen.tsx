import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, Animated, Dimensions, Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontSize, FontWeight, MIN_TAP, Radius, Shadow, Spacing, Gradients } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';
import PressableScale from '../../components/ui/PressableScale';
import Shimmer from '../../components/ui/Shimmer';
import RatingBadge from '../../components/ui/RatingBadge';
import FauxGradient from '../../components/ui/FauxGradient';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ShopDetail'>;
  route:      RouteProp<RootStackParamList, 'ShopDetail'>;
};

interface Product {
  id: string; name: string; price: number;
  stockStatus: string; imageUrl: string | null;
  description: string | null; unit: string | null;
}

interface Category { id: string; name: string; products: Product[] }
interface ShopDetail { id: string; name: string; isCurrentlyOpen: boolean; openTime: string; closeTime: string; categories: Category[]; rating?: { average: number | null; count: number } }

const COLUMNS = 2;
const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_WIDTH = (SCREEN_WIDTH - Spacing.lg * 2 - Spacing.md) / COLUMNS;

// Deterministic fallback colours for the letter-avatar when a product has no image
const AVATAR_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'] as const;
function avatarColor(name: string): string {
  const code = name.charCodeAt(0) || 0;
  return AVATAR_COLORS[code % AVATAR_COLORS.length] as string;
}

// ─── Skeleton card ────────────────────────────────────────────────────────────

function ProductCardSkeleton() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  return (
    <View style={[styles.productCard, { width: CARD_WIDTH }]}>
      <Shimmer width={CARD_WIDTH} height={CARD_WIDTH} borderRadius={Radius.lg} />
      <View style={styles.productBottom}>
        <Shimmer width="85%" height={14} />
        <View style={{ height: 6 }} />
        <Shimmer width="50%" height={14} />
        <View style={{ height: 10 }} />
        <Shimmer width="100%" height={34} borderRadius={Radius.full} />
      </View>
    </View>
  );
}

// ─── Animated quantity number ─────────────────────────────────────────────────

function BouncyQty({ qty }: { qty: number }) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const scale = useRef(new Animated.Value(1)).current;
  const last  = useRef(qty);

  useEffect(() => {
    if (last.current !== qty) {
      last.current = qty;
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.4, duration: 75, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1,   duration: 75, useNativeDriver: true }),
      ]).start();
    }
  }, [qty, scale]);

  return (
    <Animated.Text style={[styles.stepperQty, { transform: [{ scale }] }]}>
      {qty}
    </Animated.Text>
  );
}

// ─── Product card (memoised) ──────────────────────────────────────────────────

interface ProductGridCardProps {
  item:     Product;
  qty:      number;
  addLabel: string;
  outLabel: string;
  onAdd:    (productId: string) => void;
  onInc:    (productId: string, currentQty: number) => void;
  onDec:    (productId: string, currentQty: number) => void;
}

const ProductGridCard = React.memo(function ProductGridCard({
  item, qty, addLabel, outLabel, onAdd, onInc, onDec,
}: ProductGridCardProps) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const oos = item.stockStatus === 'out_of_stock';

  return (
    <View style={[styles.productCard, { width: CARD_WIDTH }, oos && styles.productCardDisabled]}>
      <View style={styles.productImageBox}>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.productImage} resizeMode="cover" />
        ) : item.name ? (
          <View style={[styles.productAvatar, { backgroundColor: avatarColor(item.name) }]}>
            <Text style={styles.productAvatarText}>{item.name.charAt(0).toUpperCase()}</Text>
          </View>
        ) : (
          <Text style={styles.productImageEmoji}>🛒</Text>
        )}
      </View>

      <View style={styles.productBottom}>
        <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
        {item.unit ? <Text style={styles.productUnit}>{item.unit}</Text> : null}
        <Text style={styles.productPrice}>₹{Math.round(item.price / 100)}</Text>

        <View style={styles.productActions}>
          {oos ? (
            <View style={styles.outBadge}>
              <Text style={styles.outBadgeText}>{outLabel}</Text>
            </View>
          ) : qty > 0 ? (
            <View style={styles.stepper}>
              <TouchableOpacity
                onPress={() => onDec(item.id, qty)}
                style={styles.stepperBtn}
                activeOpacity={0.8}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Text style={styles.stepperBtnText}>−</Text>
              </TouchableOpacity>
              <BouncyQty qty={qty} />
              <TouchableOpacity
                onPress={() => onInc(item.id, qty)}
                style={styles.stepperBtn}
                activeOpacity={0.8}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Text style={styles.stepperBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.addPill}
              onPress={() => onAdd(item.id)}
              activeOpacity={0.85}
            >
              <Text style={styles.addPillText}>{addLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
});

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ShopDetailScreen({ navigation, route }: Props) {
  const { shopId, shopName } = route.params;
  const t = useT();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  const [shop,    setShop]   = useState<ShopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]  = useState(false);
  const [cart,    setCart]   = useState<Record<string, number>>({});

  // Slide-up cart bar animation
  const cartBarY = useRef(new Animated.Value(80)).current;

  const totalCartCount = Object.values(cart).reduce((s, q) => s + q, 0);

  // Hide native header since we render our own gradient header
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const loadShop = useCallback(async () => {
    setError(false);
    try {
      const data = await api.getShop(shopId) as ShopDetail;
      setShop(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => { void loadShop(); }, [loadShop]);

  const handleRetry = useCallback(() => {
    setError(false);
    setLoading(true);
    void loadShop();
  }, [loadShop]);

  // Slide cart bar in/out
  useEffect(() => {
    Animated.spring(cartBarY, {
      toValue:         totalCartCount > 0 ? 0 : 80,
      friction:        7,
      tension:         200,
      useNativeDriver: true,
    }).start();
  }, [totalCartCount, cartBarY]);

  // ── Cart loading ───────────────────────────────────────────────────────────

  const loadCart = useCallback(async () => {
    try {
      const data = await api.getCart();
      const map: Record<string, number> = {};
      for (const item of data.items) {
        map[item.productId] = item.quantity;
      }
      setCart(map);
    } catch {
      // silently fail
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadCart();
  }, [loadCart]));

  // ── Cart mutation handlers (optimistic) ────────────────────────────────────

  const handleAdd = useCallback(async (productId: string) => {
    setCart((prev) => ({ ...prev, [productId]: 1 }));
    try {
      await api.addToCart({ productId, quantity: 1 });
    } catch (err: unknown) {
      setCart((prev) => { const n = { ...prev }; delete n[productId]; return n; });
      const msg = err instanceof Error ? err.message : t('shop.addFailed');
      Alert.alert(t('common.error'), msg);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleIncrement = useCallback(async (productId: string, currentQty: number) => {
    const newQty = currentQty + 1;
    setCart((prev) => ({ ...prev, [productId]: newQty }));
    try {
      await api.updateCartItem(productId, newQty);
    } catch {
      setCart((prev) => ({ ...prev, [productId]: currentQty }));
    }
  }, []);

  const handleDecrement = useCallback(async (productId: string, currentQty: number) => {
    const newQty = currentQty - 1;
    if (newQty <= 0) {
      setCart((prev) => { const n = { ...prev }; delete n[productId]; return n; });
    } else {
      setCart((prev) => ({ ...prev, [productId]: newQty }));
    }
    try {
      await api.updateCartItem(productId, newQty);
    } catch {
      setCart((prev) => ({ ...prev, [productId]: currentQty }));
    }
  }, []);

  function handleNotify() {
    Alert.alert('🔔', t('shop.notifyAck'));
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const allProducts = useMemo(
    () => shop?.categories.flatMap((c) => c.products) ?? [],
    [shop],
  );
  const cartSubtotal = allProducts.reduce(
    (s, p) => s + (cart[p.id] ?? 0) * Math.round(p.price / 100),
    0,
  );

  // Resolved once per render — stable string values keep ProductGridCard memoised
  const addLabel = t('shop.add');
  const outLabel = t('shop.outOfStock');

  const keyExtractor = useCallback((item: Product) => item.id, []);

  const renderProduct = useCallback(({ item }: { item: Product }) => (
    <ProductGridCard
      item={item}
      qty={cart[item.id] ?? 0}
      addLabel={addLabel}
      outLabel={outLabel}
      onAdd={handleAdd}
      onInc={handleIncrement}
      onDec={handleDecrement}
    />
  ), [cart, addLabel, outLabel, handleAdd, handleIncrement, handleDecrement]);

  // ── Gradient header (always shown) ─────────────────────────────────────────

  const renderHeader = () => (
    <FauxGradient
      from={Gradients.primary[0]}
      to={Gradients.primary[1]}
      style={[styles.header, { paddingTop: insets.top + Spacing.md }]}
    >
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerIcon}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.headerIconText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{shopName}</Text>
        <PressableScale onPress={() => navigation.navigate('Checkout')} style={styles.headerIcon}>
          <Text style={styles.headerIconText}>🛒</Text>
          {totalCartCount > 0 && (
            <View style={styles.headerCartBadge}>
              <Text style={styles.headerCartBadgeText}>{totalCartCount}</Text>
            </View>
          )}
        </PressableScale>
      </View>
    </FauxGradient>
  );

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={[styles.gridContainer, { paddingTop: Spacing.lg }]}>
          {[0, 1, 2, 3].map((k) => (
            <ProductCardSkeleton key={k} />
          ))}
        </View>
      </View>
    );
  }

  if (error || !shop) {
    return (
      <View style={styles.container}>
        {renderHeader()}
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

  // ── No-inventory empty state ───────────────────────────────────────────────

  if (allProducts.length === 0) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.shopStrip}>
          <Text style={styles.shopStripName}>{shop.name}</Text>
          <View style={styles.shopStripRow}>
            <Text style={styles.shopStripText}>🕐 {shop.openTime} – {shop.closeTime}</Text>
            <View style={[
              styles.openBadge,
              { backgroundColor: shop.isCurrentlyOpen ? Colors.accent : Colors.textMuted },
            ]}>
              <Text style={styles.openBadgeText}>
                {shop.isCurrentlyOpen ? t('shop.openNow') : t('shop.closed')}
              </Text>
            </View>
            <RatingBadge average={shop.rating?.average ?? null} count={shop.rating?.count ?? 0} size={13} />
          </View>
        </View>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>📦</Text>
          <Text style={styles.emptyTitle}>{t('shop.emptyTitle')}</Text>
          <Text style={styles.emptyBody}>{t('shop.emptyBody')}</Text>
          <PressableScale
            onPress={handleNotify}
            style={styles.notifyBtn}
          >
            <Text style={styles.notifyBtnText}>🔔  {t('shop.notifyMe')}</Text>
          </PressableScale>
        </View>
      </View>
    );
  }

  // ── Product grid ───────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {renderHeader()}

      {/* Shop info strip */}
      <View style={styles.shopStrip}>
        <Text style={styles.shopStripName}>{shop.name}</Text>
        <View style={styles.shopStripRow}>
          <Text style={styles.shopStripText}>🕐 {shop.openTime} – {shop.closeTime}</Text>
          <View style={[
            styles.openBadge,
            { backgroundColor: shop.isCurrentlyOpen ? Colors.accent : Colors.textMuted },
          ]}>
            <Text style={styles.openBadgeText}>
              {shop.isCurrentlyOpen ? t('shop.openNow') : t('shop.closed')}
            </Text>
          </View>
          <Text style={styles.shopStripRating}>{t('shop.ratingSoon')}</Text>
        </View>
      </View>

      <FlatList
        data={allProducts}
        keyExtractor={keyExtractor}
        renderItem={renderProduct}
        numColumns={COLUMNS}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={[
          styles.gridContent,
          { paddingBottom: 100 + insets.bottom },
        ]}
        removeClippedSubviews
        windowSize={5}
        maxToRenderPerBatch={8}
        initialNumToRender={6}
      />

      {/* Sticky bottom cart bar (animated slide up) */}
      <Animated.View
        style={[
          styles.cartBar,
          {
            paddingBottom: insets.bottom + Spacing.md,
            transform: [{ translateY: cartBarY }],
          },
        ]}
        pointerEvents={totalCartCount > 0 ? 'auto' : 'none'}
      >
        <TouchableOpacity
          onPress={() => navigation.navigate('Checkout')}
          activeOpacity={0.9}
          style={styles.cartBarInner}
        >
          <Text style={styles.cartBarLeft}>
            🛒  {totalCartCount} {t('shop.items')}  |  ₹{cartSubtotal}
          </Text>
          <Text style={styles.cartBarRight}>{t('shop.viewCart')}  →</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  header: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  headerIcon: {
    width: 40, height: 40,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.22)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerIconText: {
    color: Colors.white,
    fontSize: 22,
    fontWeight: '800',
  },
  headerTitle: {
    flex: 1,
    fontSize: FontSize.xl,
    fontWeight: '900',
    color: Colors.white,
  },
  headerCartBadge: {
    position: 'absolute',
    top: -2, right: -2,
    backgroundColor: Colors.warning,
    minWidth: 18, height: 18, borderRadius: 9,
    paddingHorizontal: 4,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: Colors.white,
  },
  headerCartBadgeText: {
    color: Colors.text, fontSize: 10, fontWeight: '900',
  },

  // Shop strip
  shopStrip: {
    backgroundColor: Colors.card,
    marginHorizontal: Spacing.lg,
    marginTop: -Spacing.md,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
    ...Shadow.card,
  },
  shopStripName: { fontSize: FontSize.xl, fontWeight: '900', color: Colors.text },
  shopStripRow:  {
    flexDirection: 'row', alignItems: 'center',
    gap: Spacing.sm, flexWrap: 'wrap',
  },
  shopStripText:   { fontSize: FontSize.sm, color: Colors.textLight, fontWeight: '600' },
  shopStripRating: { fontSize: FontSize.sm, color: Colors.warning, fontWeight: '700' },

  openBadge: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: Radius.full,
  },
  openBadgeText: { color: Colors.white, fontSize: FontSize.xs, fontWeight: '800' },

  // Grid
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  gridContent: {
    paddingTop: Spacing.lg,
    gap: Spacing.md,
  },
  gridRow: {
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'space-between',
  },

  // Product card
  productCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    overflow: 'visible',
    ...Shadow.sm,
  },
  productCardDisabled: { opacity: 0.55 },
  productImageBox: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: Colors.surfaceAlt,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  productImage: { width: '100%', height: '100%' },
  productAvatar: {
    width: 72, height: 72,
    borderRadius: Radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  productAvatarText: { color: Colors.white, fontSize: FontSize.xxl, fontWeight: FontWeight.heavy },
  productImageEmoji: { fontSize: 48, lineHeight: 60, includeFontPadding: false },
  productBottom: { padding: 10, gap: 2 },
  productName:   { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.textPrimary, minHeight: 36 },
  productUnit:   { fontSize: FontSize.xs, color: Colors.textMuted, marginBottom: 2 },
  productPrice:  { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.primary, marginTop: 2 },
  productActions:{ marginTop: Spacing.sm },

  addPill: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPillText: { color: Colors.white, fontWeight: FontWeight.bold, fontSize: FontSize.sm },

  outBadge: {
    backgroundColor: Colors.border,
    borderRadius: Radius.full,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outBadgeText: { fontSize: FontSize.xs, color: Colors.textLight, fontWeight: FontWeight.bold },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 34,
  },
  stepperBtn: {
    width: 34, height: 34,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: FontWeight.heavy, lineHeight: 22 },
  stepperQty: {
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    textAlign: 'center',
    minWidth: 28,
  },

  // Cart bar
  cartBar: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    ...Shadow.primary,
  },
  cartBarInner: {
    minHeight: MIN_TAP,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cartBarLeft:  { color: Colors.white, fontWeight: FontWeight.semibold, fontSize: FontSize.md },
  cartBarRight: { color: Colors.white, fontWeight: FontWeight.bold, fontSize: FontSize.md },

  // Empty
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xxl,
    gap: Spacing.md,
  },
  emptyEmoji: { fontSize: 72, lineHeight: 101, includeFontPadding: false },
  emptyTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  notifyBtn: {
    marginTop: Spacing.lg,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.md,
    backgroundColor: 'transparent',
    minHeight: MIN_TAP,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notifyBtnText: {
    color: Colors.primary,
    fontWeight: FontWeight.bold,
    fontSize: FontSize.md,
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
    fontWeight: FontWeight.bold,
    color:      Colors.textPrimary,
    textAlign:  'center',
  },
  errorSubtext: {
    fontSize:  FontSize.md,
    color:     Colors.textSecondary,
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
    fontWeight: FontWeight.bold,
    fontSize:   FontSize.md,
  },
});
