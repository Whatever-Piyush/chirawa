import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View, Image, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Dimensions,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Text } from '../../components/ui';
import ProductGridSkeleton from '../../components/product/ProductGridSkeleton';
import { FontSize, FontWeight, Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import ProductCard from '../../components/product/ProductCard';
import { fetchCategories, fetchProducts, toProductCard, type ApiProduct } from '../../services/catalog';
import { resolveCategoryView, type SubCategory } from '../home/categoryMeta';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'CategoryProducts'>;
  route:      RouteProp<RootStackParamList, 'CategoryProducts'>;
};

const { width: SCREEN_W } = Dimensions.get('window');
const RAIL_W   = 88;
const GRID_PAD = 8;
const GRID_GAP = 8;
const CARD_W   = (SCREEN_W - RAIL_W - GRID_PAD * 2 - GRID_GAP) / 2;

// Two-pane category screen: left sub-category rail + right 2-column product grid.
// Reached from the Categories tab, home tiles, and Bestsellers cards.
export default function CategoryProductsScreen({ navigation, route }: Props) {
  const { category, subCategory } = route.params;
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  const view = useMemo(() => resolveCategoryView(category), [category]);

  // Initial active sub: explicit subCategory → the incoming leaf category → first.
  const [activeSub, setActiveSub] = useState<string>(() => {
    if (subCategory && view.subs.some((s) => s.category === subCategory)) return subCategory;
    if (view.subs.some((s) => s.category === category)) return category;
    return view.subs[0]?.category ?? category;
  });

  // Live category data → thumbnails + which subs actually have products.
  const [imgByName, setImgByName] = useState<Record<string, string | null>>({});
  const [liveNames, setLiveNames] = useState<Set<string> | null>(null);

  // Per-sub product cache so re-tapping a rail item is instant.
  const cache = useRef<Map<string, ApiProduct[]>>(new Map());
  const [products, setProducts]   = useState<ApiProduct[]>([]);
  const [gridLoading, setGridLoading] = useState(true);

  useLayoutEffect(() => {
    navigation.setOptions({ title: view.mainTitle });
  }, [navigation, view.mainTitle]);

  // Load live categories once (for thumbnails + filtering empty subs).
  useEffect(() => {
    let active = true;
    fetchCategories()
      .then((cats) => {
        if (!active) return;
        const img: Record<string, string | null> = {};
        cats.forEach((c) => { img[c.name] = c.imageUrl; });
        setImgByName(img);
        setLiveNames(new Set(cats.map((c) => c.name)));
      })
      .catch(() => { /* tolerate — rail falls back to emoji + all subs */ });
    return () => { active = false; };
  }, []);

  // Fetch (or read cached) products whenever the active sub changes.
  useEffect(() => {
    let active = true;
    const cached = cache.current.get(activeSub);
    if (cached) { setProducts(cached); setGridLoading(false); return; }

    setGridLoading(true);
    fetchProducts({ category: activeSub, limit: 100 })
      .then((p) => {
        if (!active) return;
        cache.current.set(activeSub, p);
        setProducts(p);
      })
      .catch(() => { if (active) setProducts([]); })
      .finally(() => { if (active) setGridLoading(false); });
    return () => { active = false; };
  }, [activeSub]);

  // Keep only subs that exist in the live data; never blank the rail entirely.
  const subs = useMemo(() => {
    if (!liveNames) return view.subs;
    const filtered = view.subs.filter((s) => liveNames.has(s.category));
    return filtered.length > 0 ? filtered : view.subs;
  }, [view.subs, liveNames]);

  const renderRailItem = useCallback(({ item }: { item: SubCategory }) => {
    const active = item.category === activeSub;
    const uri = imgByName[item.category];
    return (
      <TouchableOpacity
        style={[styles.railItem, active && styles.railItemActive]}
        activeOpacity={0.7}
        onPress={() => setActiveSub(item.category)}
      >
        {active && <View style={styles.railBar} />}
        <View style={[styles.railThumb, active && styles.railThumbActive]}>
          {uri
            ? <Image source={{ uri }} style={styles.railImg} resizeMode="contain" />
            : <Text style={styles.railEmoji}>{item.emoji}</Text>}
        </View>
        <Text
          weight={active ? 'bold' : 'regular'}
          color={active ? Colors.primary : Colors.textSecondary}
          numberOfLines={2}
          style={styles.railLabel}
        >
          {item.label}
        </Text>
      </TouchableOpacity>
    );
  }, [activeSub, imgByName, styles, Colors]);

  return (
    <View style={styles.container}>
      {/* Left rail */}
      <View style={styles.rail}>
        <FlatList
          data={subs}
          keyExtractor={(s) => s.category}
          renderItem={renderRailItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.railList}
        />
      </View>

      {/* Right grid */}
      <View style={styles.grid}>
        {gridLoading ? (
          <ProductGridSkeleton />
        ) : products.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🧺</Text>
            <Text color={Colors.textSecondary}>No items here yet</Text>
          </View>
        ) : (
          <FlatList
            key={activeSub}             // reset scroll when switching sub
            data={products}
            keyExtractor={(p) => p.id}
            numColumns={2}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.gridPad}
            renderItem={({ item }) => <ProductCard product={toProductCard(item)} cardWidth={CARD_W} />}
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
      backgroundColor: Colors.surface,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    },
    railThumbActive: { backgroundColor: Colors.primaryLight },
    railImg:   { width: '88%', height: '88%' },
    railEmoji: { fontSize: 24 },
    railLabel: { fontSize: FontSize.xxs, lineHeight: 13, textAlign: 'center' },

    // Right grid
    grid:    { flex: 1 },
    gridPad: { padding: GRID_PAD, paddingBottom: Spacing.xxxl },
    gridRow: { gap: GRID_GAP, marginBottom: GRID_GAP },

    shimmerRow: { flexDirection: 'row', gap: GRID_GAP, marginBottom: GRID_GAP },

    empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
    emptyEmoji: { fontSize: 40 },
  });
