import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  View, Image, TextInput, TouchableOpacity, FlatList,
  StyleSheet, Alert, Animated, ScrollView, Switch, Modal, Pressable,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { SearchProductResult, SearchShopResult, SearchFilters, SearchSort, SearchSuggestion } from '@chirawa/types';
import { fetchCategories, fetchProducts, toProductCard, type ApiCategory, type ApiProduct } from '../../services/catalog';
import ProductCard, { type ProductCardData } from '../../components/product/ProductCard';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { FontSize, MIN_TAP, Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';
import { useToast } from '../../components/ui/Toast';
import Shimmer from '../../components/ui/Shimmer';
import { Text } from '../../components/ui';
import { Ionicons } from '@expo/vector-icons';
import VoiceSearchSheet from '../../components/search/VoiceSearchSheet';

// ─── Constants ────────────────────────────────────────────────────────────────

const RECENT_KEY          = 'bringly_recent_searches';
const MAX_RECENT          = 5;
const DEBOUNCE_MS         = 160;   // full-results fetch — UX sweet spot, snappier than 300
const SUGGEST_DEBOUNCE_MS = 110;   // dropdown autocomplete — even snappier
const MIN_QUERY_LEN       = 2;
const SEARCH_CACHE_MAX    = 40;    // in-session LRU of {q|filters → results}

// In-session LRU cache of full-search results. Re-typing / backspacing a prior
// query repaints INSTANTLY with zero network — the big perceived-speed win.
type CachedSearch = { products: SearchProductResult[]; shops: SearchShopResult[]; total: number };
const searchCache = new Map<string, CachedSearch>();
function cacheKeyFor(q: string, filters: SearchFilters): string {
  return `${q.trim().toLowerCase()}|${JSON.stringify(filters)}`;
}
function cacheGet(key: string): CachedSearch | undefined {
  const v = searchCache.get(key);
  if (v) { searchCache.delete(key); searchCache.set(key, v); }   // LRU bump
  return v;
}
function cacheSet(key: string, val: CachedSearch): void {
  searchCache.set(key, val);
  if (searchCache.size > SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
}

const POPULAR_CHIPS = ['आलू', 'प्याज', 'दूध', 'साबुन', 'चीनी', 'तेल'];

// Price buckets (paise). A preset-chip alternative to a native slider so the
// filter sheet stays pure-JS (no extra native module / dev-client rebuild).
type PriceBucket = { id: string; label: string; min?: number; max?: number };
const PRICE_BUCKETS: PriceBucket[] = [
  { id: 'any',     label: 'कोई भी' },
  { id: 'u50',     label: '₹50 से कम',  max: 5000 },
  { id: '50-100',  label: '₹50–₹100',   min: 5000,  max: 10000 },
  { id: '100-200', label: '₹100–₹200',  min: 10000, max: 20000 },
  { id: '200+',    label: '₹200+',      min: 20000 },
];

const SORT_OPTIONS: { id: SearchSort; label: string }[] = [
  { id: 'relevance', label: 'सबसे प्रासंगिक' },
  { id: 'priceLow',  label: 'कीमत: कम से ज़्यादा' },
  { id: 'priceHigh', label: 'कीमत: ज़्यादा से कम' },
  { id: 'rating',    label: 'रेटिंग' },
];

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

// ─── Suggestion name with the matched substring bolded ───────────────────────

function HighlightedName({ name, query }: { name: string; query: string }) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const q = query.trim().toLowerCase();
  const idx = q.length >= MIN_QUERY_LEN ? name.toLowerCase().indexOf(q) : -1;
  if (idx < 0) return <Text style={styles.suggestText} numberOfLines={1}>{name}</Text>;
  const end = idx + q.length;
  return (
    <Text style={styles.suggestText} numberOfLines={1}>
      {name.slice(0, idx)}
      <Text style={styles.suggestMatch}>{name.slice(idx, end)}</Text>
      {name.slice(end)}
    </Text>
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
  const [total,    setTotal]    = useState(0);
  // True right after a suggestion is tapped / search submitted — keeps the
  // dropdown closed until the next keystroke.
  const [justPicked, setJustPicked] = useState(false);
  const [recent,   setRecent]   = useState<string[]>([]);
  // productId → quantity map, mirrors the live cart
  const [cartMap,  setCartMap]  = useState<Record<string, number>>({});
  // Browse feed shown while the query is empty (3-up product grid to add from).
  const [feedProducts, setFeedProducts] = useState<ApiProduct[]>([]);
  // Rotating placeholder item name ("Search for" stays fixed).
  const [phIndex, setPhIndex] = useState(0);
  const phNames = useMemo(
    () => [
      t('home.searchRotate1'), t('home.searchRotate2'), t('home.searchRotate3'),
      t('home.searchRotate4'), t('home.searchRotate5'),
    ],
    [t],
  );

  // ── Filters (Chunk 4 — Task 4.2) ───────────────────────────────────────────
  const [categories, setCategories]       = useState<ApiCategory[]>([]);
  const [category, setCategory]           = useState<string | null>(null); // null = All
  const [priceBucket, setPriceBucket]     = useState('any');
  const [inStockOnly, setInStockOnly]     = useState(false);
  const [sort, setSort]                   = useState<SearchSort>('relevance');
  const [sheetOpen, setSheetOpen]         = useState(false);

  // Autocomplete dropdown (server /search/suggest) — tiny, fast, race-guarded.
  const [suggestItems, setSuggestItems] = useState<SearchSuggestion[]>([]);

  // Voice search listening sheet.
  const [voiceOpen, setVoiceOpen] = useState(false);
  // Recognition bias from our actual catalog — the biggest precision lever.
  const voiceContext = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const term of [
      ...categories.map((c) => c.name),
      ...POPULAR_CHIPS,
      ...feedProducts.map((p) => p.name),
    ]) {
      const v = term.trim();
      if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    }
    return out.slice(0, 100);
  }, [categories, feedProducts]);

  const inputRef           = useRef<TextInput>(null);
  const debounceRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef       = useRef(0);
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestIdRef       = useRef(0);

  // Current filter set, derived from state. Kept in a ref so the (stable)
  // runSearch closure always reads the latest values without being re-created.
  const filters = useMemo<SearchFilters>(() => {
    const bucket = PRICE_BUCKETS.find((b) => b.id === priceBucket);
    const f: SearchFilters = {};
    if (category) f.category = category;
    if (bucket?.min != null) f.minPrice = bucket.min;
    if (bucket?.max != null) f.maxPrice = bucket.max;
    if (inStockOnly) f.inStock = true;
    if (sort !== 'relevance') f.sort = sort;
    return f;
  }, [category, priceBucket, inStockOnly, sort]);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // Count of active "sheet" filters (category shows as its own chip row).
  const activeSheetCount =
    (priceBucket !== 'any' ? 1 : 0) + (inStockOnly ? 1 : 0) + (sort !== 'relevance' ? 1 : 0);

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

    fetchCategories()
      .then((cats) => { if (alive) setCategories(cats); })
      .catch(() => undefined);

    fetchProducts({ limit: 30 })
      .then((p) => { if (alive) setFeedProducts(p); })
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

  const applyResult = useCallback((q: string, r: CachedSearch) => {
    setProducts(r.products); setShops(r.shops); setTotal(r.total); setSearched(q);
  }, []);

  const runSearch = useCallback(async (term: string) => {
    const q = term.trim();
    if (q.length < MIN_QUERY_LEN) {
      setProducts([]); setShops([]); setSearched(''); setTotal(0);
      return;
    }
    const key = cacheKeyFor(q, filtersRef.current);
    const cached = cacheGet(key);
    if (cached) {
      // Instant repaint from cache — no spinner. Still revalidate quietly below.
      applyResult(q, cached);
      void saveRecent(q);
    }
    const thisId = ++requestIdRef.current;
    if (!cached) setLoading(true);   // shimmer only when we have nothing to show
    try {
      const result = await api.search(q, filtersRef.current);
      if (thisId !== requestIdRef.current) return;
      cacheSet(key, { products: result.products, shops: result.shops, total: result.total });
      applyResult(q, result);
      void saveRecent(q);
    } catch {
      if (thisId !== requestIdRef.current) return;
      if (!cached) { setProducts([]); setShops([]); setTotal(0); }   // keep stale on error
    } finally {
      if (thisId === requestIdRef.current) setLoading(false);
    }
  }, [saveRecent, applyResult]);

  // Lightweight autocomplete fetch for the dropdown (race-guarded, separate id).
  const fetchSuggest = useCallback(async (term: string) => {
    const q = term.trim();
    if (q.length < MIN_QUERY_LEN) { setSuggestItems([]); return; }
    const thisId = ++suggestIdRef.current;
    try {
      const res = await api.suggest(q);
      if (thisId !== suggestIdRef.current) return;
      setSuggestItems(res.suggestions);
    } catch {
      if (thisId === suggestIdRef.current) setSuggestItems([]);
    }
  }, []);

  // Re-run the current query whenever filters change (only if a query is active).
  useEffect(() => {
    if (query.trim().length >= MIN_QUERY_LEN) void runSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, priceBucket, inStockOnly, sort]);

  const handleQueryChange = useCallback((text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);
    if (text.trim().length < MIN_QUERY_LEN) {
      requestIdRef.current++;
      suggestIdRef.current++;
      setLoading(false);
      setProducts([]); setShops([]); setSearched(''); setSuggestItems([]);
      return;
    }
    // Old results stay visible (not cleared) so there's no flicker while typing.
    debounceRef.current        = setTimeout(() => void runSearch(text),    DEBOUNCE_MS);
    suggestDebounceRef.current = setTimeout(() => void fetchSuggest(text), SUGGEST_DEBOUNCE_MS);
  }, [runSearch, fetchSuggest]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);
  }, []);

  // Rotate the placeholder item name every 1.8s ("Search for" stays fixed).
  useEffect(() => {
    const id = setInterval(() => setPhIndex((i) => (i + 1) % phNames.length), 1800);
    return () => clearInterval(id);
  }, [phNames.length]);

  const fireQuery = useCallback((term: string) => {
    setQuery(term);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);
    suggestIdRef.current++;
    setSuggestItems([]);   // committing a query closes the dropdown
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

  // Map search results + browse feed to ProductCard data (3-up grid).
  const resultCards = useMemo<ProductCardData[]>(
    () => products.map((p) => ({
      productId: p.id, name: p.name, pricePaise: p.pricePaise,
      mrpPaise: null, weightLabel: null,
      imageUrl: p.imageUrl, images: p.imageUrl ? [p.imageUrl] : [],
    })),
    [products],
  );
  const feedCards = useMemo(() => feedProducts.map(toProductCard), [feedProducts]);

  // Show the autocomplete dropdown while there's an active query with results
  // from the server /search/suggest endpoint (rich rows: thumbnail + match + price).
  const showSuggest = queryActive && suggestItems.length > 0;

  // Idle (empty query): recent searches + a 3-up grid of products to add.
  function renderIdlePanel() {
    return (
      <FlatList
        key="idle-grid"
        data={feedCards}
        numColumns={3}
        keyExtractor={(it) => it.productId}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={[styles.gridContent, { paddingBottom: insets.bottom + Spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            {recent.length > 0 && (
              <View style={styles.idleSection}>
                <View style={styles.idleSectionHeader}>
                  <Text style={styles.idleSectionTitle}>{t('search.recentTitle')}</Text>
                  <TouchableOpacity onPress={() => void clearRecent()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.clearText}>{t('search.clearRecent')}</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.recentScroll}
                  contentContainerStyle={styles.recentRow}
                  keyboardShouldPersistTaps="handled"
                >
                  {recent.map((term) => (
                    <TouchableOpacity key={term} style={styles.recentChip} onPress={() => fireQuery(term)} activeOpacity={0.8}>
                      <Ionicons name="time-outline" size={14} color={Colors.textSecondary} />
                      <Text style={styles.recentChipText} numberOfLines={1}>{term}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
            {feedCards.length > 0 && (
              <Text style={styles.idleSectionTitle}>{t('search.popularTitle')}</Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <ProductCard product={item} size="compact" />
        )}
      />
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

      {/* Header — one clean rectangular field with an inline back chevron */}
      <View style={styles.headerBar}>
        <View style={styles.searchBox}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backInline}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 4 }}
          >
            <Ionicons name="chevron-back" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            placeholder={`${t('home.searchPrefix')} "${phNames[phIndex]}"`}
            placeholderTextColor={Colors.textTertiary}
            value={query}
            onChangeText={handleQueryChange}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 ? (
            <TouchableOpacity
              onPress={() => {
                setQuery(''); setProducts([]); setShops([]); setSearched(''); setSuggestItems([]);
                requestIdRef.current++;
                suggestIdRef.current++;
                inputRef.current?.focus();
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => setVoiceOpen(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t('voice.listening')}
            >
              <Ionicons name="mic-outline" size={20} color={Colors.primary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Autocomplete dropdown — server /search/suggest: thumbnail + bolded match + price */}
      {showSuggest && (
        <View style={styles.suggestBox}>
          {suggestItems.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={styles.suggestRow}
              onPress={() => fireQuery(s.name)}
              activeOpacity={0.7}
            >
              {s.imageUrl ? (
                <Image source={{ uri: s.imageUrl }} style={styles.suggestThumb} resizeMode="contain" />
              ) : (
                <View style={styles.suggestThumbEmpty}>
                  <Ionicons name="search" size={15} color={Colors.textTertiary} />
                </View>
              )}
              <HighlightedName name={s.name} query={query} />
              <Text style={styles.suggestPrice}>₹{Math.round(s.pricePaise / 100)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Filter row — category chips + Filter button (only while searching) */}
      {queryActive && (
        <View style={styles.filterBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterChipsContent}
            keyboardShouldPersistTaps="handled"
          >
            <TouchableOpacity
              style={[styles.filterChip, category === null && styles.filterChipActive]}
              onPress={() => setCategory(null)}
              activeOpacity={0.75}
            >
              <Text style={[styles.filterChipText, category === null && styles.filterChipTextActive]}>
                {t('search.allCategories')}
              </Text>
            </TouchableOpacity>
            {categories.map((c) => {
              const active = category === c.name;
              return (
                <TouchableOpacity
                  key={c.name}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => setCategory(active ? null : c.name)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]} numberOfLines={1}>
                    {c.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity
            style={[styles.filterBtn, activeSheetCount > 0 && styles.filterBtnActive]}
            onPress={() => setSheetOpen(true)}
            activeOpacity={0.8}
          >
            <Text style={[styles.filterBtnText, activeSheetCount > 0 && styles.filterBtnTextActive]}>
              ⚙︎ {t('search.filter')}{activeSheetCount > 0 ? ` (${activeSheetCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Loading shimmer — only when there's nothing to show yet (no stale results),
          so typing over existing results never flickers to a skeleton. */}
      {loading && !hasResults && (
        <View style={styles.body}>
          <SkeletonRow /><SkeletonRow /><SkeletonRow />
        </View>
      )}

      {/* Idle: popular + recent */}
      {showIdle && renderIdlePanel()}

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

      {/* Results — 3-up product grid (shops listed above). Stays visible while a
          fresh query loads (results swap in when ready) → no flicker. */}
      {hasResults && (
        <FlatList
          key="results-grid"
          data={resultCards}
          numColumns={3}
          keyExtractor={(it) => it.productId}
          columnWrapperStyle={styles.gridRow}
          ListHeaderComponent={
            <View>
              {shops.length > 0 && (
                <>
                  <Text style={styles.sectionHeader}>{t('search.shopsSection')}</Text>
                  {shops.map((s) => (
                    <ShopCard
                      key={s.id}
                      shop={s}
                      openLabel={t('search.open')}
                      closedLabel={t('search.closed')}
                      onPress={() => navigation.navigate('ShopDetail', { shopId: s.id, shopName: s.name })}
                    />
                  ))}
                </>
              )}
              {total > 0 && (
                <Text style={styles.resultCount}>{total} {t('search.resultsFound')}</Text>
              )}
            </View>
          }
          contentContainerStyle={[styles.gridContent, { paddingBottom: insets.bottom + Spacing.xxl }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => <ProductCard product={item} size="compact" />}
        />
      )}

      {/* ── Filter bottom sheet ───────────────────────────────────────────── */}
      <Modal
        visible={sheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetOpen(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setSheetOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('search.filter')}</Text>

            {/* Price range */}
            <Text style={styles.sheetSectionTitle}>{t('search.priceRange')}</Text>
            <View style={styles.sheetChipRow}>
              {PRICE_BUCKETS.map((b) => {
                const active = priceBucket === b.id;
                return (
                  <TouchableOpacity
                    key={b.id}
                    style={[styles.sheetChip, active && styles.sheetChipActive]}
                    onPress={() => setPriceBucket(b.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.sheetChipText, active && styles.sheetChipTextActive]}>{b.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* In-stock toggle */}
            <View style={styles.sheetToggleRow}>
              <Text style={styles.sheetSectionTitle}>{t('search.inStockOnly')}</Text>
              <Switch
                value={inStockOnly}
                onValueChange={setInStockOnly}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor={Colors.white}
              />
            </View>

            {/* Sort */}
            <Text style={styles.sheetSectionTitle}>{t('search.sortBy')}</Text>
            {SORT_OPTIONS.map((o) => {
              const active = sort === o.id;
              return (
                <TouchableOpacity
                  key={o.id}
                  style={styles.sheetRadioRow}
                  onPress={() => setSort(o.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.radioOuter, active && styles.radioOuterActive]}>
                    {active && <View style={styles.radioInner} />}
                  </View>
                  <Text style={styles.sheetRadioLabel}>{o.label}</Text>
                </TouchableOpacity>
              );
            })}

            {/* Actions */}
            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={styles.sheetReset}
                onPress={() => { setPriceBucket('any'); setInStockOnly(false); setSort('relevance'); }}
                activeOpacity={0.8}
              >
                <Text style={styles.sheetResetText}>{t('search.reset')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.sheetApply}
                onPress={() => setSheetOpen(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.sheetApplyText}>{t('search.applyFilters')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Voice search — listening sheet (auto-runs the search on a final transcript) */}
      <VoiceSearchSheet
        visible={voiceOpen}
        contextualStrings={voiceContext}
        onClose={() => setVoiceOpen(false)}
        onResult={fireQuery}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  headerBar: {
    paddingHorizontal: Spacing.lg,
    paddingTop:        Spacing.sm,
    paddingBottom:     Spacing.md,
    backgroundColor:   Colors.surface,
  },
  searchBox: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   Colors.surface,
    borderRadius:      12,            // rectangular (rounded corners), not a pill
    paddingHorizontal: Spacing.sm,
    height:            52,
    gap:               Spacing.xs,
    borderWidth:       1,
    borderColor:       Colors.border,
    // soft, clean lift
    shadowColor:   '#000',
    shadowOpacity: 0.05,
    shadowRadius:  6,
    shadowOffset:  { width: 0, height: 2 },
    elevation:     2,
  },
  backInline:  { paddingHorizontal: 4, justifyContent: 'center', alignItems: 'center' },
  searchInput: { flex: 1, fontSize: FontSize.md, color: Colors.textPrimary, marginLeft: 2 },

  // Recent searches — horizontal scroll, rectangular chips
  recentScroll: { marginHorizontal: -Spacing.lg },
  recentRow:    { flexDirection: 'row', gap: 10, paddingHorizontal: Spacing.lg, paddingVertical: 2 },
  recentChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surface,
    paddingHorizontal: 14, paddingVertical: 11,
    borderRadius: 10,                 // rectangular chip
    borderWidth: 1, borderColor: Colors.border,
  },
  recentChipText: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: '600', maxWidth: 160 },

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
  resultCount: {
    fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.xs,
  },

  // 3-up product grid (idle feed + results)
  gridContent: { paddingTop: Spacing.md, paddingHorizontal: Spacing.lg },
  gridRow:     { gap: 12, marginBottom: 12 },

  // Autocomplete suggestions
  suggestBox: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  suggestRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.divider,
  },
  suggestThumb: {
    width: 36, height: 36, borderRadius: Radius.sm, backgroundColor: Colors.surfaceAlt,
  },
  suggestThumbEmpty: {
    width: 36, height: 36, borderRadius: Radius.sm, backgroundColor: Colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  suggestIcon: { fontSize: 13, opacity: 0.6 },
  suggestText:  { flex: 1, fontSize: FontSize.md, color: Colors.textSecondary },
  suggestMatch: { color: Colors.textPrimary, fontWeight: '800' },
  suggestPrice: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.textPrimary },

  // Filter bar (category chips + Filter button)
  filterBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    paddingRight: Spacing.sm,
  },
  filterChipsContent: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: Spacing.sm },
  filterChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.full,
    backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.border,
    maxWidth: 140,
  },
  filterChipActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText:       { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  filterChipTextActive: { color: Colors.white },
  filterBtn: {
    paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  filterBtnActive:     { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  filterBtnText:       { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary },
  filterBtnTextActive: { color: Colors.primary },

  // Bottom sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm,
  },
  sheetHandle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, marginBottom: Spacing.md,
  },
  sheetTitle: { fontSize: FontSize.lg, fontWeight: '900', color: Colors.textPrimary, marginBottom: Spacing.md },
  sheetSectionTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary, marginTop: Spacing.md, marginBottom: Spacing.sm },
  sheetChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  sheetChip: {
    paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.full,
    backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.border,
  },
  sheetChipActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  sheetChipText:       { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  sheetChipTextActive: { color: Colors.white },
  sheetToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetRadioRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  radioOuter: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.border,
    justifyContent: 'center', alignItems: 'center',
  },
  radioOuterActive: { borderColor: Colors.primary },
  radioInner:       { width: 11, height: 11, borderRadius: 6, backgroundColor: Colors.primary },
  sheetRadioLabel:  { fontSize: FontSize.md, color: Colors.textPrimary, fontWeight: '500' },
  sheetActions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.lg },
  sheetReset: {
    flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TAP,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border,
  },
  sheetResetText: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textSecondary },
  sheetApply: {
    flex: 2, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TAP,
    borderRadius: Radius.full, backgroundColor: Colors.primary, ...Shadow.primary,
  },
  sheetApplyText: { fontSize: FontSize.md, fontWeight: '800', color: Colors.white },
});
