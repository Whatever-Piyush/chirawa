import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  View, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { SearchProductResult, SearchShopResult } from '@chirawa/types';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { FontSize, MIN_TAP, Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';
import { useToast } from '../../components/ui/Toast';
import Shimmer from '../../components/ui/Shimmer';
import { Text } from '../../components/ui';

// ─── Constants ────────────────────────────────────────────────────────────────

const RECENT_KEY    = 'bringly_recent_searches';
const MAX_RECENT    = 5;
const DEBOUNCE_MS   = 300;
const MIN_QUERY_LEN = 2;

const POPULAR_CHIPS = ['आलू', 'प्याज', 'दूध', 'साबुन', 'चीनी', 'तेल'];

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Search'>;
};

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  return (
    <View style={styles.skeletonRow}>
      <Shimmer width={48} height={48} borderRadius={Radius.md} />
      <View style={styles.skeletonText}>
        <Shimmer width="65%" height={14} />
        <View style={{ height: 6 }} />
        <Shimmer width="40%" height={11} />
      </View>
      <Shimmer width={56} height={32} borderRadius={Radius.full} />
    </View>
  );
}

// ─── Animated qty number — exact copy of ShopDetailScreen.BouncyQty ──────────

function BouncyQty({ qty }: { qty: number }) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
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

// ─── Shop card ────────────────────────────────────────────────────────────────

function ShopCard({
  shop, onPress, openLabel, closedLabel,
}: {
  shop: SearchShopResult;
  onPress: () => void;
  openLabel: string;
  closedLabel: string;
}) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const initial = shop.name.charAt(0).toUpperCase();
  return (
    <TouchableOpacity style={styles.shopCard} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.shopAvatar}>
        <Text style={styles.shopAvatarText}>{initial}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.shopName} numberOfLines={1}>{shop.name}</Text>
        <Text style={styles.shopAddress} numberOfLines={1}>{shop.address}</Text>
      </View>
      <View style={[styles.openBadge, { backgroundColor: shop.isOpen ? Colors.successLight : Colors.surfaceAlt }]}>
        <Text style={[styles.openBadgeText, { color: shop.isOpen ? Colors.success : Colors.textMuted }]}>
          {shop.isOpen ? openLabel : closedLabel}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Product row — React.memo so only the row whose qty changed re-renders ────

const ProductRow = React.memo(function ProductRow({
  product, qty, onAdd, onIncrement, onDecrement, addLabel,
}: {
  product: SearchProductResult;
  qty: number;
  onAdd: (product: SearchProductResult) => void;
  onIncrement: (productId: string, currentQty: number) => void;
  onDecrement: (productId: string, currentQty: number) => void;
  addLabel: string;
}) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const initial     = product.name.charAt(0).toUpperCase();
  const priceRupees = Math.round(product.pricePaise / 100);

  return (
    <View style={styles.productRow}>
      <View style={styles.productAvatar}>
        <Text style={styles.productAvatarText}>{initial}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
        <Text style={styles.productShop} numberOfLines={1}>🏪 {product.shopName}</Text>
      </View>
      <View style={styles.productRight}>
        <Text style={styles.productPrice}>₹{priceRupees}</Text>
        {qty > 0 ? (
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => onDecrement(product.id, qty)}
              activeOpacity={0.8}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.stepperBtnText}>−</Text>
            </TouchableOpacity>
            <BouncyQty qty={qty} />
            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => onIncrement(product.id, qty)}
              activeOpacity={0.8}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={styles.stepperBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => onAdd(product)}
            activeOpacity={0.8}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Text style={styles.addBtnText}>{addLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SearchScreen({ navigation }: Props) {
  const t      = useT();
  const insets = useSafeAreaInsets();
  const toast  = useToast();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  const [query,    setQuery]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [products, setProducts] = useState<SearchProductResult[]>([]);
  const [shops,    setShops]    = useState<SearchShopResult[]>([]);
  const [searched, setSearched] = useState('');
  const [recent,   setRecent]   = useState<string[]>([]);
  // productId → quantity map, mirrors the live cart
  const [cartMap,  setCartMap]  = useState<Record<string, number>>({});

  const inputRef     = useRef<TextInput>(null);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  // ── Load recent searches + current cart on mount ──────────────────────────

  useEffect(() => {
    let alive = true;

    AsyncStorage.getItem(RECENT_KEY)
      .then((raw) => { if (alive && raw) setRecent(JSON.parse(raw) as string[]); })
      .catch(() => undefined);

    api.getCart()
      .then((data) => {
        if (!alive) return;
        const map: Record<string, number> = {};
        for (const item of data.items) map[item.productId] = item.quantity;
        setCartMap(map);
      })
      .catch(() => undefined);

    const focusTimer = setTimeout(() => {
      if (alive) inputRef.current?.focus();
    }, 80);

    return () => {
      alive = false;
      clearTimeout(focusTimer);
    };
  }, []);

  // ── Recent searches ────────────────────────────────────────────────────────

  const saveRecent = useCallback(async (term: string) => {
    const next = [term, ...recent.filter((r) => r !== term)].slice(0, MAX_RECENT);
    setRecent(next);
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => undefined);
  }, [recent]);

  const clearRecent = useCallback(async () => {
    setRecent([]);
    await AsyncStorage.removeItem(RECENT_KEY).catch(() => undefined);
  }, []);

  // ── Core search ────────────────────────────────────────────────────────────

  const runSearch = useCallback(async (term: string) => {
    const q = term.trim();
    if (q.length < MIN_QUERY_LEN) {
      setProducts([]); setShops([]); setSearched('');
      return;
    }
    const thisId = ++requestIdRef.current;
    setLoading(true);
    try {
      const result = await api.search(q);
      if (thisId !== requestIdRef.current) return;
      setProducts(result.products);
      setShops(result.shops);
      setSearched(q);
      void saveRecent(q);
    } catch {
      if (thisId !== requestIdRef.current) return;
      setProducts([]); setShops([]);
    } finally {
      if (thisId === requestIdRef.current) setLoading(false);
    }
  }, [saveRecent]);

  const handleQueryChange = useCallback((text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < MIN_QUERY_LEN) {
      requestIdRef.current++;
      setLoading(false);
      setProducts([]); setShops([]); setSearched('');
      return;
    }
    debounceRef.current = setTimeout(() => void runSearch(text), DEBOUNCE_MS);
  }, [runSearch]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const fireQuery = useCallback((term: string) => {
    setQuery(term);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void runSearch(term);
  }, [runSearch]);

  // ── Cart mutation handlers (optimistic, matching ShopDetailScreen) ─────────

  const handleAdd = useCallback(async (product: SearchProductResult) => {
    setCartMap((prev) => ({ ...prev, [product.id]: 1 }));
    try {
      await api.addToCart({ productId: product.id, quantity: 1 });
      toast.show(t('search.addedToCart'), 'success');
    } catch (err: unknown) {
      setCartMap((prev) => { const n = { ...prev }; delete n[product.id]; return n; });
      const msg = err instanceof Error ? err.message : t('search.addFailed');
      Alert.alert(t('common.error'), msg);
    }
  }, [toast, t]);

  const handleIncrement = useCallback(async (productId: string, currentQty: number) => {
    const newQty = currentQty + 1;
    setCartMap((prev) => ({ ...prev, [productId]: newQty }));
    try {
      await api.updateCartItem(productId, newQty);
    } catch {
      setCartMap((prev) => ({ ...prev, [productId]: currentQty }));
    }
  }, []);

  const handleDecrement = useCallback(async (productId: string, currentQty: number) => {
    const newQty = currentQty - 1;
    if (newQty <= 0) {
      setCartMap((prev) => { const n = { ...prev }; delete n[productId]; return n; });
    } else {
      setCartMap((prev) => ({ ...prev, [productId]: newQty }));
    }
    try {
      await api.updateCartItem(productId, Math.max(0, newQty));
    } catch {
      setCartMap((prev) => ({ ...prev, [productId]: currentQty }));
    }
  }, []);

  // ── Derived display state ──────────────────────────────────────────────────

  const hasResults  = products.length > 0 || shops.length > 0;
  const queryActive = query.trim().length >= MIN_QUERY_LEN;
  const showEmpty   = queryActive && !loading && searched === query.trim() && !hasResults;
  const showIdle    = !queryActive;

  function renderIdlePanel() {
    return (
      <View style={styles.idlePanel}>
        {recent.length > 0 && (
          <View style={styles.idleSection}>
            <View style={styles.idleSectionHeader}>
              <Text style={styles.idleSectionTitle}>{t('search.recentTitle')}</Text>
              <TouchableOpacity onPress={() => void clearRecent()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.clearText}>{t('search.clearRecent')}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.chipRow}>
              {recent.map((term) => (
                <TouchableOpacity key={term} style={styles.chip} onPress={() => fireQuery(term)} activeOpacity={0.75}>
                  <Text style={styles.chipText}>🕐 {term}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        <View style={styles.idleSection}>
          <Text style={styles.idleSectionTitle}>{t('search.popularTitle')}</Text>
          <View style={styles.chipRow}>
            {POPULAR_CHIPS.map((chip) => (
              <TouchableOpacity key={chip} style={styles.chipPopular} onPress={() => fireQuery(chip)} activeOpacity={0.75}>
                <Text style={styles.chipPopularText}>{chip}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    );
  }

  // ── Section data for FlatList ──────────────────────────────────────────────

  type Section =
    | { type: 'shop-header' }
    | { type: 'shop'; item: SearchShopResult }
    | { type: 'product-header' }
    | { type: 'product'; item: SearchProductResult };

  const sections: Section[] = [
    ...(shops.length > 0 ? [
      { type: 'shop-header' as const },
      ...shops.map((s) => ({ type: 'shop' as const, item: s })),
    ] : []),
    ...(products.length > 0 ? [
      { type: 'product-header' as const },
      ...products.map((p) => ({ type: 'product' as const, item: p })),
    ] : []),
  ];

  // Stable renderItem so React.memo on ProductRow is effective:
  // cartMap changes trigger re-creation here, but React.memo skips re-render
  // for any ProductRow whose qty didn't actually change.
  const renderItem = useCallback(({ item }: { item: Section }) => {
    if (item.type === 'shop-header') {
      return <Text style={styles.sectionHeader}>{t('search.shopsSection')}</Text>;
    }
    if (item.type === 'product-header') {
      return <Text style={styles.sectionHeader}>{t('search.productsSection')}</Text>;
    }
    if (item.type === 'shop') {
      return (
        <ShopCard
          shop={item.item}
          openLabel={t('search.open')}
          closedLabel={t('search.closed')}
          onPress={() => navigation.navigate('ShopDetail', { shopId: item.item.id, shopName: item.item.name })}
        />
      );
    }
    const prod = item.item;
    const qty  = cartMap[prod.id] ?? 0;
    return (
      <ProductRow
        product={prod}
        qty={qty}
        addLabel={t('search.addToCart')}
        onAdd={handleAdd}
        onIncrement={handleIncrement}
        onDecrement={handleDecrement}
      />
    );
  }, [cartMap, t, navigation, handleAdd, handleIncrement, handleDecrement]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* Header bar */}
      <View style={styles.headerBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            placeholder={t('search.placeholder')}
            placeholderTextColor={Colors.textTertiary}
            value={query}
            onChangeText={handleQueryChange}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                setQuery(''); setProducts([]); setShops([]); setSearched('');
                requestIdRef.current++;
                inputRef.current?.focus();
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.clearBtn}>×</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Loading shimmer */}
      {loading && (
        <View style={styles.body}>
          <SkeletonRow /><SkeletonRow /><SkeletonRow />
        </View>
      )}

      {/* Idle: popular + recent */}
      {!loading && showIdle && renderIdlePanel()}

      {/* No results */}
      {!loading && showEmpty && (
        <View style={styles.noResults}>
          <Text style={styles.noResultsEmoji}>😕</Text>
          <Text style={styles.noResultsText}>
            "{searched}" {t('search.noResults')}
          </Text>
          <TouchableOpacity style={styles.browseBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
            <Text style={styles.browseBtnText}>{t('search.browseShops')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Results */}
      {!loading && hasResults && (
        <FlatList
          data={sections}
          keyExtractor={(item, index) =>
            item.type === 'shop'    ? `shop-${item.item.id}` :
            item.type === 'product' ? `prod-${item.item.id}` :
            `${item.type}-${index}`
          }
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + Spacing.xxl }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          renderItem={renderItem}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  headerBar: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    backgroundColor:   Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.sm,
  },
  backBtn:   { padding: Spacing.xs, minWidth: MIN_TAP, minHeight: MIN_TAP, justifyContent: 'center', alignItems: 'center' },
  backArrow: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.textPrimary },
  searchBox: {
    flex:              1,
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   Colors.background,
    borderRadius:      Radius.full,
    paddingHorizontal: Spacing.md,
    height:            44,
    gap:               Spacing.xs,
    borderWidth:       1,
    borderColor:       Colors.border,
  },
  searchIcon:  { fontSize: 15, color: Colors.textTertiary },
  searchInput: { flex: 1, fontSize: FontSize.md, color: Colors.textPrimary },
  clearBtn:    { fontSize: 22, color: Colors.textMuted, fontWeight: '700', paddingHorizontal: 4 },

  // Body / skeleton
  body:         { padding: Spacing.lg, gap: Spacing.md },
  skeletonRow:  {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, marginBottom: 1,
  },
  skeletonText: { flex: 1, gap: 4 },

  // Section header
  sectionHeader: {
    fontSize:          FontSize.sm,
    fontWeight:        '800',
    color:             Colors.textSecondary,
    paddingHorizontal: Spacing.lg,
    paddingTop:        Spacing.lg,
    paddingBottom:     Spacing.xs,
    textTransform:     'uppercase',
    letterSpacing:     0.6,
  },

  // Shop card
  shopCard: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical:   Spacing.md,
    backgroundColor:   Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    minHeight:         MIN_TAP + 8,
  },
  shopAvatar:     { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryLight, justifyContent: 'center', alignItems: 'center' },
  shopAvatarText: { fontSize: FontSize.lg, fontWeight: '900', color: Colors.primary },
  shopName:       { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary },
  shopAddress:    { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  openBadge:      { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: Radius.full },
  openBadgeText:  { fontSize: FontSize.xs, fontWeight: '700' },

  // Product row
  productRow: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical:   Spacing.md,
    backgroundColor:   Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
    minHeight:         MIN_TAP + 8,
  },
  productAvatar:     { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt, justifyContent: 'center', alignItems: 'center' },
  productAvatarText: { fontSize: FontSize.xl, fontWeight: '900', color: Colors.textSecondary },
  productName:       { fontSize: FontSize.md, fontWeight: '600', color: Colors.textPrimary, lineHeight: 20 },
  productShop:       { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  productRight:      { alignItems: 'flex-end', gap: 4 },
  productPrice:      { fontSize: FontSize.md, fontWeight: '900', color: Colors.primary },

  // "+ जोड़ें" add button (qty = 0)
  addBtn: {
    backgroundColor:   Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical:   6,
    borderRadius:      Radius.full,
    minHeight:         32,
    justifyContent:    'center',
    ...Shadow.xs,
  },
  addBtnText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: '800' },

  // "− qty +" stepper (qty > 0) — exact match with ShopDetailScreen
  stepper: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    backgroundColor:   Colors.accent,
    borderRadius:      Radius.full,
    paddingHorizontal: 4,
    minHeight:         38,
  },
  stepperBtn:     { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  stepperBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '900', lineHeight: 22 },
  stepperQty:     { color: Colors.white, fontSize: FontSize.md, fontWeight: '900', textAlign: 'center', minWidth: 18 },

  // No results — overflow visible so emoji isn't clipped
  noResults: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.xxl, gap: Spacing.md,
    overflow: 'visible',
  },
  noResultsEmoji: {
    fontSize:             48,
    lineHeight:           68,
    includeFontPadding:   false,
    textAlignVertical:    'center',
  },
  noResultsText: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  browseBtn: {
    marginTop: Spacing.md, backgroundColor: Colors.primary,
    borderRadius: Radius.full, paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md, minHeight: MIN_TAP, justifyContent: 'center',
    ...Shadow.primary,
  },
  browseBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },

  // Idle panel
  idlePanel:         { padding: Spacing.lg, gap: Spacing.xl },
  idleSection:       { gap: Spacing.md },
  idleSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  idleSectionTitle:  { fontSize: FontSize.md, fontWeight: '800', color: Colors.textPrimary },
  clearText:         { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '700' },
  chipRow:           { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    backgroundColor: Colors.surfaceAlt, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border,
  },
  chipText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '600' },
  chipPopular: {
    backgroundColor: Colors.primaryLight, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.primaryMid,
  },
  chipPopularText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '700' },

  // List
  listContent: { paddingBottom: Spacing.xxl },
});
