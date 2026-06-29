import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View, Image, FlatList, TouchableOpacity, StyleSheet, Dimensions,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Text } from '../../components/ui';
import ProductGridSkeleton from '../../components/product/ProductGridSkeleton';
import { FontSize, Radius, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import ProductCard, { type ProductCardData } from '../../components/product/ProductCard';
import { api } from '../../services/api.service';
import { fetchShops, type ApiShop } from '../../services/catalog';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ShopDetail'>;
  route:      RouteProp<RootStackParamList, 'ShopDetail'>;
};

// Raw product shape returned by GET /catalog/shops/:id (price in paise, raw
// stockStatus string). Mapped onto ProductCardData for the grid.
interface ShopProduct {
  id: string; name: string; price: number;
  stockStatus: string; imageUrl: string | null;
  description: string | null; unit: string | null;
}
interface ShopCategory { id: string; name: string; products: ShopProduct[] }
interface ShopDetail {
  id: string; name: string;
  isCurrentlyOpen: boolean; openTime: string; closeTime: string;
  categories: ShopCategory[];
  rating?: { average: number | null; count: number };
}

const { width: SCREEN_W } = Dimensions.get('window');
const RAIL_W   = 88;
const GRID_PAD = 8;
const GRID_GAP = 8;
const CARD_W   = (SCREEN_W - RAIL_W - GRID_PAD * 2 - GRID_GAP) / 2;

// Deterministic letter-avatar fill for the rail (shops carry no image).
const AVATAR_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFB677'] as const;
function avatarColor(name: string): string {
  const code = name.charCodeAt(0) || 0;
  return AVATAR_COLORS[code % AVATAR_COLORS.length] as string;
}

// One shop product → ProductCardData. The shop endpoint has no MRP / image set /
// variants, so those stay empty (the card simply hides discount + carousel dots).
function toShopCard(p: ShopProduct): ProductCardData {
  return {
    productId:   p.id,
    name:        p.name,
    pricePaise:  p.price,
    mrpPaise:    null,
    weightLabel: p.unit,
    imageUrl:    p.imageUrl,
    images:      p.imageUrl ? [p.imageUrl] : [],
    hasVariants: false,
  };
}

// Two-pane shop screen: left rail of all shops + right 2-column product grid.
// Tapping a rail shop swaps the right pane in place (no navigation), mirroring
// the category surface. The global CartDockPill + ProductCard's CartContext own
// the cart, so this screen holds no cart state of its own.
export default function ShopDetailScreen({ navigation, route }: Props) {
  const { shopId, shopName } = route.params;
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  // The shop whose items fill the right pane. Starts at the one we navigated to.
  const [activeId, setActiveId]     = useState<string>(shopId);
  const [activeName, setActiveName] = useState<string>(shopName);

  // Rail data — all shops. Falls back to just the incoming shop if the list fails.
  const [shops, setShops] = useState<ApiShop[]>([]);

  // Per-shop product cache so re-tapping a rail shop is instant.
  const cache = useRef<Map<string, ProductCardData[]>>(new Map());
  const [products, setProducts]   = useState<ProductCardData[]>([]);
  const [gridLoading, setGridLoading] = useState(true);

  // Native header carries the active shop's name (replaces the old gradient header).
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: true, title: activeName });
  }, [navigation, activeName]);

  // Load the shop rail once. The Special surface is featured-only, so the rail
  // mirrors that — keep only featured shops (drops the aggregate "Chirawa store").
  useEffect(() => {
    let active = true;
    fetchShops()
      .then((list) => { if (active) setShops(list.filter((s) => s.isFeatured)); })
      .catch(() => { /* tolerate — rail collapses to the active shop only */ });
    return () => { active = false; };
  }, []);

  // Fetch (or read cached) products whenever the active shop changes.
  useEffect(() => {
    let active = true;
    const cached = cache.current.get(activeId);
    if (cached) { setProducts(cached); setGridLoading(false); return; }

    setGridLoading(true);
    api.getShop(activeId)
      .then((data) => {
        if (!active) return;
        const detail = data as ShopDetail;
        const cards = detail.categories.flatMap((c) => c.products).map(toShopCard);
        cache.current.set(activeId, cards);
        setProducts(cards);
        // Prefer the canonical name from the payload over the rail/route name.
        if (detail.name) setActiveName(detail.name);
      })
      .catch(() => { if (active) setProducts([]); })
      .finally(() => { if (active) setGridLoading(false); });
    return () => { active = false; };
  }, [activeId]);

  // Featured shops, but never drop the shop we actually opened (prepend it if the
  // featured list doesn't include it — and it's the only entry until the fetch lands).
  const railShops = useMemo<Pick<ApiShop, 'id' | 'name'>[]>(() => {
    if (shops.some((s) => s.id === shopId)) return shops;
    return [{ id: shopId, name: shopName }, ...shops];
  }, [shops, shopId, shopName]);

  const onSelectShop = useCallback((id: string, name: string) => {
    setActiveId(id);
    setActiveName(name);
  }, []);

  const renderRailItem = useCallback(({ item }: { item: Pick<ApiShop, 'id' | 'name'> }) => {
    const active = item.id === activeId;
    return (
      <TouchableOpacity
        style={[styles.railItem, active && styles.railItemActive]}
        activeOpacity={0.7}
        onPress={() => onSelectShop(item.id, item.name)}
      >
        {active && <View style={styles.railBar} />}
        <View style={[styles.railThumb, { backgroundColor: avatarColor(item.name) }]}>
          <Text weight="bold" color={Colors.white} style={styles.railThumbText}>
            {item.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text
          weight={active ? 'bold' : 'regular'}
          color={active ? Colors.primary : Colors.textSecondary}
          numberOfLines={2}
          style={styles.railLabel}
        >
          {item.name}
        </Text>
      </TouchableOpacity>
    );
  }, [activeId, onSelectShop, styles, Colors]);

  return (
    <View style={styles.container}>
      {/* Left rail — all shops */}
      <View style={styles.rail}>
        <FlatList
          data={railShops}
          keyExtractor={(s) => s.id}
          renderItem={renderRailItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.railList}
        />
      </View>

      {/* Right grid — selected shop's items */}
      <View style={styles.grid}>
        {gridLoading ? (
          <ProductGridSkeleton />
        ) : products.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📦</Text>
            <Text color={Colors.textSecondary}>No items here yet</Text>
          </View>
        ) : (
          <FlatList
            key={activeId}             // reset scroll when switching shop
            data={products}
            keyExtractor={(p) => p.productId}
            numColumns={2}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.gridPad}
            renderItem={({ item }) => <ProductCard product={item} cardWidth={CARD_W} />}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    container: { flex: 1, flexDirection: 'row', backgroundColor: Colors.background },

    // Left rail
    rail: {
      width: RAIL_W,
      backgroundColor: Colors.surfaceAlt,
      borderRightWidth: 1, borderRightColor: Colors.border,
    },
    railList: { paddingVertical: Spacing.sm },
    railItem: {
      paddingVertical: Spacing.md, paddingHorizontal: 6,
      alignItems: 'center', gap: 5,
    },
    railItemActive: { backgroundColor: Colors.surface },
    railBar: {
      position: 'absolute', left: 0, top: 8, bottom: 8, width: 3,
      borderTopRightRadius: 3, borderBottomRightRadius: 3,
      backgroundColor: Colors.primary,
    },
    railThumb: {
      width: 52, height: 52, borderRadius: Radius.md,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    },
    railThumbText: { fontSize: 22 },
    railLabel: { fontSize: FontSize.xxs, lineHeight: 13, textAlign: 'center' },

    // Right grid
    grid:    { flex: 1 },
    gridPad: { padding: GRID_PAD, paddingBottom: Spacing.xxxl },
    gridRow: { gap: GRID_GAP, marginBottom: GRID_GAP },

    empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
    emptyEmoji: { fontSize: 40 },
  });
