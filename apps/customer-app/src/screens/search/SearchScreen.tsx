import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import {
  View, TextInput, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { SearchProductResult, SearchShopResult } from '@chirawa/types';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Colors, FontSize, MIN_TAP, Radius, Shadow, Spacing } from '../../theme';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';
import { useToast } from '../../components/ui/Toast';
import Shimmer from '../../components/ui/Shimmer';
import { Text } from '../../components/ui';

// ─── Constants ────────────────────────────────────────────────────────────────

const RECENT_KEY     = 'bringly_recent_searches';
const MAX_RECENT     = 5;
const DEBOUNCE_MS    = 300;
const MIN_QUERY_LEN  = 2;

const POPULAR_CHIPS  = ['आलू', 'प्याज', 'दूध', 'साबुन', 'चीनी', 'तेल'];

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Search'>;
};

// ─── Shimmer skeleton row ──────────────────────────────────────────────────────

function SkeletonRow() {
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

// ─── Compact shop card ────────────────────────────────────────────────────────

function ShopCard({
  shop, onPress, openLabel, closedLabel,
}: {
  shop: SearchShopResult;
  onPress: () => void;
  openLabel: string;
  closedLabel: string;
}) {
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

// ─── Product row ──────────────────────────────────────────────────────────────

function ProductRow({
  product, onAdd, addLabel,
}: {
  product: SearchProductResult;
  onAdd: () => void;
  addLabel: string;
}) {
  const initial    = product.name.charAt(0).toUpperCase();
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
        <TouchableOpacity
          style={styles.addBtn}
          onPress={onAdd}
          activeOpacity={0.8}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={styles.addBtnText}>{addLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SearchScreen({ navigation }: Props) {
  const t      = useT();
  const insets = useSafeAreaInsets();
  const toast  = useToast();

  const [query,   setQuery]   = useState('');
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<SearchProductResult[]>([]);
  const [shops,    setShops]    = useState<SearchShopResult[]>([]);
  const [searched, setSearched] = useState('');      // last query that produced results
  const [recent,   setRecent]   = useState<string[]>([]);
  const [adding,   setAdding]   = useState<Set<string>>(new Set());

  const inputRef       = useRef<TextInput>(null);
  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef   = useRef(0); // stale-result guard

  // ── Load recent searches on mount ──────────────────────────────────────────

  useEffect(() => {
    AsyncStorage.getItem(RECENT_KEY)
      .then((raw) => {
        if (raw) setRecent(JSON.parse(raw) as string[]);
      })
      .catch(() => undefined);

    // Auto-focus
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  // ── Persist + update recent searches ───────────────────────────────────────

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
      setProducts([]);
      setShops([]);
      setSearched('');
      return;
    }

    const thisId = ++requestIdRef.current;
    setLoading(true);

    try {
      const result = await api.search(q);
      if (thisId !== requestIdRef.current) return; // stale — a newer request is in flight
      setProducts(result.products);
      setShops(result.shops);
      setSearched(q);
      void saveRecent(q);
    } catch {
      if (thisId !== requestIdRef.current) return;
      setProducts([]);
      setShops([]);
    } finally {
      if (thisId === requestIdRef.current) setLoading(false);
    }
  }, [saveRecent]);

  // ── Debounced query change ─────────────────────────────────────────────────

  const handleQueryChange = useCallback((text: string) => {
    setQuery(text);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (text.trim().length < MIN_QUERY_LEN) {
      requestIdRef.current++; // cancel any in-flight
      setLoading(false);
      setProducts([]);
      setShops([]);
      setSearched('');
      return;
    }

    debounceRef.current = setTimeout(() => {
      void runSearch(text);
    }, DEBOUNCE_MS);
  }, [runSearch]);

  // Cleanup debounce on unmount
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // ── Fire search immediately (chip tap / recent tap) ────────────────────────

  const fireQuery = useCallback((term: string) => {
    setQuery(term);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void runSearch(term);
  }, [runSearch]);

  // ── Add to cart ────────────────────────────────────────────────────────────

  const handleAddToCart = useCallback(async (product: SearchProductResult) => {
    if (adding.has(product.id)) return;
    setAdding((prev) => new Set([...prev, product.id]));
    try {
      await api.addToCart({ productId: product.id, quantity: 1 });
      toast.show(t('search.addedToCart'), 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('search.addFailed');
      Alert.alert(t('common.error'), msg);
    } finally {
      setAdding((prev) => { const next = new Set(prev); next.delete(product.id); return next; });
    }
  }, [adding, toast, t]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const hasResults  = products.length > 0 || shops.length > 0;
  const queryActive = query.trim().length >= MIN_QUERY_LEN;
  const showEmpty   = queryActive && !loading && searched === query.trim() && !hasResults;
  const showIdle    = !queryActive;

  // ─── Idle panel: recent searches + popular chips ───────────────────────────

  function renderIdlePanel() {
    return (
      <View style={styles.idlePanel}>
        {/* Recent searches */}
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
                <TouchableOpacity
                  key={term}
                  style={styles.chip}
                  onPress={() => fireQuery(term)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.chipText}>🕐 {term}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Popular chips */}
        <View style={styles.idleSection}>
          <Text style={styles.idleSectionTitle}>{t('search.popularTitle')}</Text>
          <View style={styles.chipRow}>
            {POPULAR_CHIPS.map((chip) => (
              <TouchableOpacity
                key={chip}
                style={styles.chipPopular}
                onPress={() => fireQuery(chip)}
                activeOpacity={0.75}
              >
                <Text style={styles.chipPopularText}>{chip}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    );
  }

  // ── Section list data ──────────────────────────────────────────────────────

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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* ── Header bar ────────────────────────────────────────────────────── */}
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
                setQuery('');
                setProducts([]);
                setShops([]);
                setSearched('');
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

      {/* ── Body ──────────────────────────────────────────────────────────── */}

      {/* Loading shimmer */}
      {loading && (
        <View style={styles.body}>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
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
          <TouchableOpacity
            style={styles.browseBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.85}
          >
            <Text style={styles.browseBtnText}>{t('search.browseShops')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Results */}
      {!loading && hasResults && (
        <FlatList
          data={sections}
          keyExtractor={(item, index) =>
            item.type === 'shop'           ? `shop-${item.item.id}` :
            item.type === 'product'        ? `prod-${item.item.id}` :
            `${item.type}-${index}`
          }
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + Spacing.xxl }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
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
                  onPress={() =>
                    navigation.navigate('ShopDetail', {
                      shopId:   item.item.id,
                      shopName: item.item.name,
                    })
                  }
                />
              );
            }
            // product
            return (
              <ProductRow
                product={item.item}
                addLabel={t('search.addToCart')}
                onAdd={() => void handleAddToCart(item.item)}
              />
            );
          }}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  headerBar: {
    flexDirection:    'row',
    alignItems:       'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:  Spacing.sm,
    backgroundColor:  Colors.surface,
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

  // Body
  body: { padding: Spacing.lg, gap: Spacing.md },

  // Skeleton
  skeletonRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical:   Spacing.md,
    backgroundColor:   Colors.surface,
    marginBottom:      1,
  },
  skeletonText: { flex: 1, gap: 4 },

  // Section header
  sectionHeader: {
    fontSize:         FontSize.sm,
    fontWeight:       '800',
    color:            Colors.textSecondary,
    paddingHorizontal: Spacing.lg,
    paddingTop:        Spacing.lg,
    paddingBottom:     Spacing.xs,
    textTransform:    'uppercase',
    letterSpacing:    0.6,
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
  shopAvatar: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center', alignItems: 'center',
  },
  shopAvatarText: { fontSize: FontSize.lg, fontWeight: '900', color: Colors.primary },
  shopName:       { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary },
  shopAddress:    { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  openBadge: {
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
    borderRadius: Radius.full,
  },
  openBadgeText: { fontSize: FontSize.xs, fontWeight: '700' },

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
  productAvatar: {
    width: 48, height: 48, borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
    justifyContent: 'center', alignItems: 'center',
  },
  productAvatarText: { fontSize: FontSize.xl, fontWeight: '900', color: Colors.textSecondary },
  productName:  { fontSize: FontSize.md, fontWeight: '600', color: Colors.textPrimary, lineHeight: 20 },
  productShop:  { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  productRight: { alignItems: 'flex-end', gap: 4 },
  productPrice: { fontSize: FontSize.md, fontWeight: '900', color: Colors.primary },
  addBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical:   6,
    borderRadius: Radius.full,
    minHeight: 32,
    justifyContent: 'center',
    ...Shadow.xs,
  },
  addBtnText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: '800' },

  // No results
  noResults: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.xxl, gap: Spacing.md,
  },
  noResultsEmoji: { fontSize: 56 },
  noResultsText:  { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  browseBtn: {
    marginTop: Spacing.md, backgroundColor: Colors.primary,
    borderRadius: Radius.full, paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md, minHeight: MIN_TAP, justifyContent: 'center',
    ...Shadow.primary,
  },
  browseBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },

  // Idle panel
  idlePanel:       { padding: Spacing.lg, gap: Spacing.xl },
  idleSection:     { gap: Spacing.md },
  idleSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  idleSectionTitle:{ fontSize: FontSize.md, fontWeight: '800', color: Colors.textPrimary },
  clearText:       { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '700' },
  chipRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
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
