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
import { Colors, FontSize, MIN_TAP, Radius, Spacing } from '../../theme';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Cart'> };

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonRow() {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 600, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View style={[styles.skeletonRow, { opacity }]}>
      <View style={styles.skeletonImage} />
      <View style={styles.skeletonText}>
        <View style={[styles.skeletonLine, { width: '70%' }]} />
        <View style={[styles.skeletonLine, { width: '40%', marginTop: 8 }]} />
        <View style={[styles.skeletonLine, { width: '55%', marginTop: 6 }]} />
      </View>
      <View style={styles.skeletonStepper} />
    </Animated.View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function CartScreen({ navigation }: Props) {
  const t = useT();
  const [cart, setCart] = useState<CartResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState<Set<string>>(new Set());

  const itemCount = cart?.items.length ?? 0;

  // Custom header: "Your Cart" title + item-count badge
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

  // ─── Data loading ──────────────────────────────────────────────────────────

  const loadCart = useCallback(async () => {
    try {
      const data = await api.getCart();
      setCart(data);
    } catch {
      Alert.alert(t('common.error'), t('common.retry'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void loadCart(); }, [loadCart]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await api.getCart();
      setCart(data);
    } catch {
      // silent — user sees stale data
    } finally {
      setRefreshing(false);
    }
  }, []);

  // ─── Cart mutations ────────────────────────────────────────────────────────

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

    // Optimistic update
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
      void loadCart(); // revert
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

  // ─── Render item ───────────────────────────────────────────────────────────

  const renderItem = useCallback(({ item }: { item: CartItem }) => {
    const isUpdating = updating.has(item.productId);
    const unitRupees = Math.round(item.unitPrice / 100);
    const subtotalRupees = Math.round(item.subtotal / 100);

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
          {/* Product image */}
          <View style={styles.itemImageBox}>
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={styles.itemImage} resizeMode="cover" />
            ) : (
              <Text style={styles.itemImageEmoji}>🛒</Text>
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

            <Text style={styles.stepperQty}>{item.quantity}</Text>

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

  // ─── Pricing summary ───────────────────────────────────────────────────────

  const subtotalRupees = cart ? Math.round(cart.subtotal / 100) : 0;
  const totalRupees = subtotalRupees; // delivery fee calculated at checkout

  // ─── Loading skeleton ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.container}>
        {[1, 2, 3].map((k) => <SkeletonRow key={k} />)}
      </View>
    );
  }

  // ─── Empty state ───────────────────────────────────────────────────────────

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
            activeOpacity={0.8}
          >
            <Text style={styles.shopNowText}>{t('cart.shopNow')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Cart ──────────────────────────────────────────────────────────────────

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

      <FlatList
        data={cart.items}
        keyExtractor={(item) => item.productId}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
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

      {/* Sticky bottom pricing + checkout */}
      <View style={styles.bottomBar}>
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
          <Text style={styles.checkoutBtnText}>{t('cart.checkout')}</Text>
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
  skeletonImage:   { width: 64, height: 64, backgroundColor: Colors.border, borderRadius: Radius.md },
  skeletonText:    { flex: 1 },
  skeletonLine:    { height: 13, backgroundColor: Colors.border, borderRadius: Radius.sm },
  skeletonStepper: { width: 96, height: MIN_TAP, backgroundColor: Colors.border, borderRadius: Radius.md },

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

  // Shop banner
  shopBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.card, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  shopBannerText: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  clearBtn:       { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: Spacing.xs },
  clearBtnText:   { fontSize: FontSize.sm, color: Colors.error, fontWeight: '600' },

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
    width: 64, height: 64, backgroundColor: Colors.background,
    borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
  },
  itemImage:      { width: 64, height: 64 },
  itemImageEmoji: { fontSize: 32 },
  itemInfo:       { flex: 1, gap: 2 },
  itemName:       { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  itemUnitPrice:  { fontSize: FontSize.sm, color: Colors.textLight },
  itemSubtotal:   { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },

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
    color: Colors.white, fontSize: FontSize.xl, fontWeight: '700',
    lineHeight: FontSize.xl + 4,
  },
  stepperQty: {
    minWidth: 32, textAlign: 'center',
    fontSize: FontSize.lg, fontWeight: '700', color: Colors.text,
  },

  // Swipe delete action
  deleteAction: {
    backgroundColor: Colors.error, justifyContent: 'center',
    alignItems: 'center', width: 80,
  },
  deleteActionIcon: { fontSize: 22 },
  deleteActionText: { color: Colors.white, fontSize: FontSize.xs, fontWeight: '700', marginTop: 2 },

  // Bottom bar
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.border,
    padding: Spacing.lg, gap: Spacing.sm,
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1, shadowRadius: 8, elevation: 8,
  },
  pricingRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pricingLabel:{ fontSize: FontSize.md, color: Colors.textLight },
  pricingValue:{ fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  freeText:    { color: Colors.success },
  totalRow: {
    borderTopWidth: 1, borderTopColor: Colors.border,
    paddingTop: Spacing.sm, marginTop: Spacing.xs,
  },
  totalLabel:     { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  totalValue:     { fontSize: FontSize.lg, fontWeight: '800', color: Colors.primary },
  checkoutBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.lg,
    paddingVertical: Spacing.md, alignItems: 'center',
    minHeight: MIN_TAP, justifyContent: 'center', marginTop: Spacing.xs,
  },
  checkoutBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '800' },
});
