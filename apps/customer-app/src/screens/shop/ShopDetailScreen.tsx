import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, Animated, Dimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize, MIN_TAP, Radius, Shadow, Spacing, Gradients } from '../../theme';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';
import PressableScale from '../../components/ui/PressableScale';
import Shimmer from '../../components/ui/Shimmer';
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
interface ShopDetail { id: string; name: string; isCurrentlyOpen: boolean; openTime: string; closeTime: string; categories: Category[] }

const COLUMNS = 2;
const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_WIDTH = (SCREEN_WIDTH - Spacing.lg * 2 - Spacing.md) / COLUMNS;

// ─── Skeleton card ────────────────────────────────────────────────────────────

function ProductCardSkeleton() {
  return (
    <View style={[styles.productCard, { width: CARD_WIDTH }]}>
      <Shimmer width={CARD_WIDTH - Spacing.md * 2} height={CARD_WIDTH - Spacing.md * 2} borderRadius={Radius.md} />
      <View style={{ height: 8 }} />
      <Shimmer width="80%" height={14} />
      <View style={{ height: 6 }} />
      <Shimmer width="50%" height={12} />
      <View style={{ height: 10 }} />
      <Shimmer width="100%" height={36} borderRadius={Radius.md} />
    </View>
  );
}

// ─── Animated quantity number ─────────────────────────────────────────────────

function BouncyQty({ qty }: { qty: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  const last  = useRef(qty);

  useEffect(() => {
    if (last.current !== qty) {
      last.current = qty;
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.3, friction: 4, tension: 200, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1,   friction: 5, tension: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [qty, scale]);

  return (
    <Animated.Text style={[styles.stepperQty, { transform: [{ scale }] }]}>
      {qty}
    </Animated.Text>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ShopDetailScreen({ navigation, route }: Props) {
  const { shopId, shopName } = route.params;
  const t = useT();
  const insets = useSafeAreaInsets();

  const [shop,    setShop]   = useState<ShopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [cart,    setCart]   = useState<Record<string, number>>({});

  // Slide-up cart bar animation
  const cartBarY = useRef(new Animated.Value(120)).current;

  const totalCartCount = Object.values(cart).reduce((s, q) => s + q, 0);

  // Hide native header since we render our own gradient header
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    void loadShop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId]);

  // Slide cart bar in/out
  useEffect(() => {
    Animated.spring(cartBarY, {
      toValue:         totalCartCount > 0 ? 0 : 120,
      friction:        7,
      tension:         100,
      useNativeDriver: true,
    }).start();
  }, [totalCartCount, cartBarY]);

  async function loadShop() {
    try {
      const data = await api.getShop(shopId) as ShopDetail;
      setShop(data);
    } catch {
      Alert.alert(t('common.error'), t('shop.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

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

  async function handleAdd(productId: string) {
    setCart((prev) => ({ ...prev, [productId]: 1 }));
    try {
      await api.addToCart({ productId, quantity: 1 });
    } catch (err: unknown) {
      setCart((prev) => { const n = { ...prev }; delete n[productId]; return n; });
      const msg = err instanceof Error ? err.message : t('shop.addFailed');
      Alert.alert(t('common.error'), msg);
    }
  }

  async function handleIncrement(productId: string, currentQty: number) {
    const newQty = currentQty + 1;
    setCart((prev) => ({ ...prev, [productId]: newQty }));
    try {
      await api.updateCartItem(productId, newQty);
    } catch {
      setCart((prev) => ({ ...prev, [productId]: currentQty }));
    }
  }

  async function handleDecrement(productId: string, currentQty: number) {
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
  }

  function handleNotify() {
    Alert.alert('🔔', t('shop.notifyAck'));
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const allProducts = shop?.categories.flatMap((c) => c.products) ?? [];
  const cartSubtotal = allProducts.reduce(
    (s, p) => s + (cart[p.id] ?? 0) * Math.round(p.price / 100),
    0,
  );

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
        <PressableScale onPress={() => navigation.navigate('Cart')} style={styles.headerIcon}>
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

  if (!shop) {
    return <View style={styles.container}>{renderHeader()}</View>;
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
            <Text style={styles.shopStripRating}>{t('shop.ratingSoon')}</Text>
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
        keyExtractor={(item) => item.id}
        numColumns={COLUMNS}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={[
          styles.gridContent,
          { paddingBottom: 100 + insets.bottom },
        ]}
        renderItem={({ item }) => {
          const qty  = cart[item.id] ?? 0;
          const oos  = item.stockStatus === 'out_of_stock';
          return (
            <PressableScale
              scaleTo={0.97}
              onPress={() => undefined}
              style={[styles.productCard, { width: CARD_WIDTH }, oos && styles.productCardDisabled]}
            >
              <View style={styles.productImageBox}>
                <Text style={styles.productImageEmoji}>🛒</Text>
              </View>
              <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
              {item.unit ? <Text style={styles.productUnit}>{item.unit}</Text> : null}
              <Text style={styles.productPrice}>₹{Math.round(item.price / 100)}</Text>
              <View style={styles.productActions}>
                {oos ? (
                  <View style={styles.outBadge}>
                    <Text style={styles.outBadgeText}>{t('shop.outOfStock')}</Text>
                  </View>
                ) : qty > 0 ? (
                  <View style={styles.stepper}>
                    <TouchableOpacity
                      onPress={() => void handleDecrement(item.id, qty)}
                      style={styles.stepperBtn}
                      activeOpacity={0.8}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Text style={styles.stepperBtnText}>−</Text>
                    </TouchableOpacity>
                    <BouncyQty qty={qty} />
                    <TouchableOpacity
                      onPress={() => void handleIncrement(item.id, qty)}
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
                    onPress={() => void handleAdd(item.id)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.addPillText}>{t('shop.add')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </PressableScale>
          );
        }}
      />

      {/* Sticky bottom cart bar (animated slide up) */}
      <Animated.View
        style={[
          styles.cartBar,
          {
            paddingBottom: Spacing.lg + insets.bottom,
            transform: [{ translateY: cartBarY }],
          },
        ]}
        pointerEvents={totalCartCount > 0 ? 'auto' : 'none'}
      >
        <TouchableOpacity
          onPress={() => navigation.navigate('Cart')}
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

const styles = StyleSheet.create({
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
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    gap: Spacing.md,
  },
  gridRow: {
    gap: Spacing.md,
    justifyContent: 'space-between',
  },

  // Product card
  productCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    ...Shadow.card,
    gap: 2,
  },
  productCardDisabled: { opacity: 0.55 },
  productImageBox: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  productImageEmoji: { fontSize: 44 },
  productName:   { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, minHeight: 36 },
  productUnit:   { fontSize: FontSize.xs, color: Colors.textMuted, marginBottom: 2 },
  productPrice:  { fontSize: FontSize.lg, fontWeight: '900', color: Colors.primary, marginTop: 2 },
  productActions:{ marginTop: Spacing.sm },

  addPill: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
  },
  addPillText: { color: Colors.white, fontWeight: '800', fontSize: FontSize.sm },

  outBadge: {
    backgroundColor: Colors.border,
    borderRadius: Radius.full,
    paddingVertical: 10,
    alignItems: 'center',
  },
  outBadgeText: { fontSize: FontSize.xs, color: Colors.textLight, fontWeight: '700' },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.accent,
    borderRadius: Radius.full,
    paddingHorizontal: 4,
    minHeight: 38,
  },
  stepperBtn: {
    width: 32, height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '900', lineHeight: 22 },
  stepperQty: {
    color: Colors.white,
    fontSize: FontSize.md,
    fontWeight: '900',
    textAlign: 'center',
    minWidth: 18,
  },

  // Cart bar
  cartBar: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    ...Shadow.strong,
  },
  cartBarInner: {
    minHeight: MIN_TAP,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cartBarLeft:  { color: Colors.white, fontWeight: '800', fontSize: FontSize.md },
  cartBarRight: { color: Colors.white, fontWeight: '900', fontSize: FontSize.md },

  // Empty
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xxl,
    gap: Spacing.md,
  },
  emptyEmoji: { fontSize: 80 },
  emptyTitle: {
    fontSize: FontSize.xxl,
    fontWeight: '900',
    color: Colors.text,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: FontSize.md,
    color: Colors.textLight,
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
    backgroundColor: Colors.primaryLight,
    minHeight: MIN_TAP,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notifyBtnText: {
    color: Colors.primary,
    fontWeight: '800',
    fontSize: FontSize.md,
  },
});
