import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  RefreshControl,
  Animated,
  Image,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CartItem, CartResponse } from '@chirawa/types';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize, MIN_TAP, Radius, Shadow, Spacing } from '../../theme';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';
import Shimmer from '../../components/ui/Shimmer';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Cart'> };

// Distinct fallback bg colours for avatar circles when no imageUrl
const AVATAR_COLORS = ['#FF3E6C', '#7C5CFF', '#00B894', '#FDCB6E', '#2D9CDB', '#FF8C42'];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h] as string;
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <View style={styles.skeletonRow}>
      <Shimmer width={64} height={64} borderRadius={Radius.md} />
      <View style={styles.skeletonText}>
        <Shimmer width="70%" height={14} />
        <View style={{ height: 8 }} />
        <Shimmer width="40%" height={12} />
        <View style={{ height: 6 }} />
        <Shimmer width="55%" height={12} />
      </View>
      <Shimmer width={96} height={MIN_TAP} borderRadius={Radius.md} />
    </View>
  );
}

// ─── Animated stepper qty ────────────────────────────────────────────────────

function BouncyNumber({ value }: { value: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  const last  = useRef(value);
  useEffect(() => {
    if (last.current !== value) {
      last.current = value;
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.3, friction: 4, tension: 200, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1,   friction: 5, tension: 220, useNativeDriver: true }),
      ]).start();
    }
  }, [value, scale]);
  return (
    <Animated.Text style={[styles.stepperQty, { transform: [{ scale }] }]}>
      {value}
    </Animated.Text>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function CartScreen({ navigation }: Props) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [cart, setCart] = useState<CartResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState<Set<string>>(new Set());

  // Swipe-hint state — visible on first cart load with items, fades after 2s
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const swipeHintOpacity = useRef(new Animated.Value(0)).current;

  const itemCount = cart?.items.length ?? 0;

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <View style={styles.headerTitle}>
          <Text style={styles.headerTitleText}>{t('cart.title')}</Text>
          {itemCount > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{itemCount}</Text>
            </View>
          )}
        </View>
      ),
    });
  }, [navigation, itemCount, t]);

  const loadCart = useCallback(async () => {
    try {
      const data = await api.getCart();
      setCart(data);
    } catch {
      Alert.alert(t('common.error'), t('common.retry'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void loadCart(); }, [loadCart]);

  // Show swipe hint once when cart has items
  useEffect(() => {
    if (!loading && itemCount > 0 && !showSwipeHint) {
      setShowSwipeHint(true);
      Animated.sequence([
        Animated.timing(swipeHintOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.delay(1600),
        Animated.timing(swipeHintOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start(() => setShowSwipeHint(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, itemCount]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await api.getCart();
      setCart(data);
    } catch {
      // silent
    } finally {
      setRefreshing(false);
    }
  }, []);

  const markUpdating = (id: string, on: boolean) =>
    setUpdating((prev) => {
      const next = new Set(prev);
      on ? next.add(id) : next.delete(id);
      return next;
    });

  const handleQuantityChange = useCallback(async (
    productId: string,
    delta: number,
    currentQty: number,
  ) => {
    const newQty = currentQty + delta;

    setCart((prev) => {
      if (!prev) return prev;
      if (newQty <= 0) {
        return { ...prev, items: prev.items.filter((i) => i.productId !== productId) };
      }
      return {
        ...prev,
        items: prev.items.map((i) =>
          i.productId === productId ? { ...i, quantity: newQty } : i,
        ),
      };
    });

    markUpdating(productId, true);
    try {
      const updated = await api.updateCartItem(productId, Math.max(0, newQty));
      setCart(updated);
    } catch {
      void loadCart();
      Alert.alert(t('common.error'), t('common.retry'));
    } finally {
      markUpdating(productId, false);
    }
  }, [loadCart, t]);

  const handleRemoveItem = useCallback(async (productId: string) => {
    setCart((prev) => prev
      ? { ...prev, items: prev.items.filter((i) => i.productId !== productId) }
      : prev,
    );
    try {
      const updated = await api.updateCartItem(productId, 0);
      setCart(updated);
    } catch {
      void loadCart();
      Alert.alert(t('common.error'), t('common.retry'));
    }
  }, [loadCart, t]);

  const handleClearCart = useCallback(() => {
    Alert.alert(t('cart.clearCart'), t('cart.clearCartConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.confirm'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.clearCart();
            setCart((prev) => prev ? { ...prev, items: [] } : null);
          } catch {
            Alert.alert(t('common.error'), t('common.retry'));
          }
        },
      },
    ]);
  }, [t]);

  const renderItem = useCallback(({ item }: { item: CartItem }) => {
    const isUpdating     = updating.has(item.productId);
    const unitRupees     = Math.round(item.unitPrice / 100);
    const subtotalRupees = Math.round(item.subtotal / 100);
    const firstLetter    = (item.productName?.[0] ?? '?').toUpperCase();

    const renderRightActions = () => (
      <TouchableOpacity
        style={styles.deleteAction}
        onPress={() => void handleRemoveItem(item.productId)}
        activeOpacity={0.8}
      >
        <Text style={styles.deleteActionIcon}>🗑️</Text>
        <Text style={styles.deleteActionText}>{t('cart.remove')}</Text>
      </TouchableOpacity>
    );

    return (
      <Swipeable renderRightActions={renderRightActions} overshootRight={false}>
        <View style={styles.itemRow}>
          {/* Avatar / image */}
          <View style={styles.itemImageBox}>
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={styles.itemImage} resizeMode="cover" />
            ) : (
              <View style={[styles.itemAvatar, { backgroundColor: avatarColor(item.productName) }]}>
                <Text style={styles.itemAvatarText}>{firstLetter}</Text>
              </View>
            )}
          </View>

          {/* Name + pricing */}
          <View style={styles.itemInfo}>
            <Text style={styles.itemName} numberOfLines={2}>{item.productName}</Text>
            <Text style={styles.itemUnitPrice}>₹{unitRupees} × {item.quantity}</Text>
            <Text style={styles.itemSubtotal}>= ₹{subtotalRupees}</Text>
          </View>

          {/* Quantity stepper */}
          <View style={[styles.stepper, isUpdating && styles.stepperDisabled]}>
            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => !isUpdating && void handleQuantityChange(item.productId, -1, item.quantity)}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.stepperBtnText}>−</Text>
            </TouchableOpacity>

            <BouncyNumber value={item.quantity} />

            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => !isUpdating && void handleQuantityChange(item.productId, 1, item.quantity)}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.stepperBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Swipeable>
    );
  }, [updating, handleQuantityChange, handleRemoveItem, t]);

  const subtotalRupees = cart ? Math.round(cart.subtotal / 100) : 0;
  const totalRupees    = subtotalRupees;
  const savings        = subtotalRupees > 200 ? Math.round(subtotalRupees * 0.08) : 0;
  const freeDelivery   = subtotalRupees > 0; // current backend gives free delivery for this town

  if (loading) {
    return (
      <View style={styles.container}>
        {[1, 2, 3].map((k) => <SkeletonRow key={k} />)}
      </View>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>🛒</Text>
          <Text style={styles.emptyTitle}>{t('cart.empty')}</Text>
          <Text style={styles.emptyHint}>{t('cart.emptyHint')}</Text>
          <TouchableOpacity
            style={styles.shopNowBtn}
            onPress={() => navigation.navigate('MainTabs')}
            activeOpacity={0.85}
          >
            <Text style={styles.shopNowText}>{t('cart.shopNow')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Shop name + clear button */}
      <View style={styles.shopBanner}>
        <Text style={styles.shopBannerText}>🏪 {cart.shopName}</Text>
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={handleClearCart}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.clearBtnText}>{t('cart.clearCart')}</Text>
        </TouchableOpacity>
      </View>

      {/* Savings chip */}
      {savings > 0 && (
        <View style={styles.savingsWrap}>
          <Text style={styles.savingsText}>
            🎉  {t('cart.saved')}{savings}{t('cart.savedSuffix')}
          </Text>
        </View>
      )}

      <FlatList
        data={cart.items}
        keyExtractor={(item) => item.productId}
        renderItem={renderItem}
        contentContainerStyle={[styles.listContent, { paddingBottom: 240 + insets.bottom }]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
          />
        }
      />

      {/* Swipe hint overlay */}
      {showSwipeHint && (
        <Animated.View style={[styles.swipeHint, { opacity: swipeHintOpacity }]} pointerEvents="none">
          <Text style={styles.swipeHintText}>← {t('cart.swipeHint')}</Text>
        </Animated.View>
      )}

      {/* Sticky bottom */}
      <View style={[styles.bottomBar, { paddingBottom: Spacing.lg + insets.bottom }]}>
        {freeDelivery && (
          <View style={styles.freeBanner}>
            <Text style={styles.freeBannerText}>✓  {t('cart.freeDeliveryNote')}</Text>
          </View>
        )}
        <View style={styles.pricingRow}>
          <Text style={styles.pricingLabel}>{t('cart.subtotal')}</Text>
          <Text style={styles.pricingValue}>₹{subtotalRupees}</Text>
        </View>
        <View style={styles.pricingRow}>
          <Text style={styles.pricingLabel}>{t('cart.deliveryFee')}</Text>
          <Text style={[styles.pricingValue, styles.freeText]}>{t('cart.freeDelivery')}</Text>
        </View>
        <View style={[styles.pricingRow, styles.totalRow]}>
          <Text style={styles.totalLabel}>{t('cart.total')}</Text>
          <Text style={styles.totalValue}>₹{totalRupees}</Text>
        </View>
        <TouchableOpacity
          style={styles.checkoutBtn}
          onPress={() => navigation.navigate('Checkout')}
          activeOpacity={0.9}
        >
          <Text style={styles.checkoutBtnText}>{t('cart.checkout')}  →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  headerTitle:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerTitleText: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  countBadge: {
    backgroundColor: Colors.primary, borderRadius: Radius.full,
    minWidth: 22, height: 22, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6,
  },
  countBadgeText: { color: Colors.white, fontSize: FontSize.xs, fontWeight: '800' },

  // Skeleton
  skeletonRow: {
    flexDirection: 'row', gap: Spacing.md, padding: Spacing.lg,
    backgroundColor: Colors.card, marginHorizontal: Spacing.lg,
    marginTop: Spacing.md, borderRadius: Radius.lg,
    alignItems: 'center',
  },
  skeletonText: { flex: 1 },

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
    ...Shadow.strong,
  },
  shopNowText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },

  // Shop banner
  shopBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.card, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  shopBannerText: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  clearBtn:       { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: Spacing.xs },
  clearBtnText:   { fontSize: FontSize.sm, color: Colors.error, fontWeight: '700' },

  // Savings chip
  savingsWrap: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    backgroundColor: '#E8F8F0',
    borderRadius: Radius.full,
    paddingVertical: 8,
    paddingHorizontal: Spacing.lg,
    alignSelf: 'flex-start',
  },
  savingsText: {
    fontSize: FontSize.sm,
    color: Colors.accent,
    fontWeight: '800',
  },

  // List
  listContent: { paddingBottom: 220 },
  separator:   { height: 1, backgroundColor: Colors.border },

  // Item row
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md, minHeight: MIN_TAP + 24,
  },
  itemImageBox: {
    width: 64, height: 64,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.background,
  },
  itemImage:      { width: 64, height: 64 },
  itemAvatar:     { width: 64, height: 64, justifyContent: 'center', alignItems: 'center' },
  itemAvatarText: { fontSize: 28, fontWeight: '900', color: Colors.white },
  itemInfo:       { flex: 1, gap: 2 },
  itemName:       { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  itemUnitPrice:  { fontSize: FontSize.sm, color: Colors.textLight },
  itemSubtotal:   { fontSize: FontSize.sm, fontWeight: '800', color: Colors.primary },

  // Stepper
  stepper: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.background, borderRadius: Radius.md, padding: Spacing.xs,
  },
  stepperDisabled: { opacity: 0.5 },
  stepperBtn: {
    width: MIN_TAP, height: MIN_TAP, borderRadius: Radius.md,
    backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center',
  },
  stepperBtnText: {
    color: Colors.white, fontSize: FontSize.xl, fontWeight: '900',
    lineHeight: FontSize.xl + 4,
  },
  stepperQty: {
    minWidth: 32, textAlign: 'center',
    fontSize: FontSize.lg, fontWeight: '800', color: Colors.text,
  },

  // Swipe action
  deleteAction: {
    backgroundColor: Colors.error, justifyContent: 'center',
    alignItems: 'center', width: 80,
  },
  deleteActionIcon: { fontSize: 22 },
  deleteActionText: { color: Colors.white, fontSize: FontSize.xs, fontWeight: '800', marginTop: 2 },

  // Swipe hint
  swipeHint: {
    position: 'absolute',
    top: 90,
    right: Spacing.lg,
    backgroundColor: Colors.secondary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    ...Shadow.card,
  },
  swipeHintText: {
    color: Colors.white,
    fontWeight: '700',
    fontSize: FontSize.sm,
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.border,
    padding: Spacing.lg, gap: Spacing.sm,
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1, shadowRadius: 8, elevation: 8,
  },
  freeBanner: {
    backgroundColor: '#E8F8F0',
    borderRadius: Radius.sm,
    paddingVertical: 6,
    alignItems: 'center',
  },
  freeBannerText: {
    color: Colors.accent,
    fontWeight: '700',
    fontSize: FontSize.sm,
  },
  pricingRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pricingLabel:{ fontSize: FontSize.md, color: Colors.textLight },
  pricingValue:{ fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  freeText:    { color: Colors.accent },
  totalRow: {
    borderTopWidth: 1, borderTopColor: Colors.border,
    paddingTop: Spacing.sm, marginTop: Spacing.xs,
  },
  totalLabel:     { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  totalValue:     { fontSize: FontSize.lg, fontWeight: '900', color: Colors.primary },
  checkoutBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.lg,
    paddingVertical: Spacing.md, alignItems: 'center',
    minHeight: MIN_TAP, justifyContent: 'center', marginTop: Spacing.xs,
    ...Shadow.strong,
  },
  checkoutBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '900' },
});
