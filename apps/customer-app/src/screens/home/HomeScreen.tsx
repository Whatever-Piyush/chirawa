import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, FlatList, StyleSheet,
  RefreshControl, TouchableOpacity, ScrollView, Animated,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize, FontWeight, MIN_TAP, Radius, Shadow, Spacing } from '../../theme';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';
import {
  Text,
  Badge,
  Shimmer,
  PressableScale,
  FauxGradient,
} from '../../components/ui';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'MainTabs'> };

interface Shop {
  id: string; name: string; description: string | null;
  estimatedDeliveryMinutes: number; isCurrentlyOpen: boolean;
  address: string; logoUrl: string | null;
}

const SHOP_PALETTE = [
  Colors.primary,
  Colors.success,
  Colors.warning,
  Colors.info,
] as const;

// ─── Skeleton card ──────────────────────────────────────────────────────────
function ShopCardSkeleton() {
  return (
    <View style={styles.shopCard}>
      <Shimmer width={80} height={80} borderRadius={Radius.lg} />
      <View style={styles.shopBody}>
        <Shimmer width="65%" height={18} borderRadius={Radius.xs} />
        <View style={{ height: Spacing.sm }} />
        <Shimmer width="80%" height={12} borderRadius={Radius.xs} />
        <View style={{ height: Spacing.sm }} />
        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
          <Shimmer width={72} height={22} borderRadius={Radius.full} />
          <Shimmer width={56} height={22} borderRadius={Radius.full} />
        </View>
      </View>
    </View>
  );
}

// ─── Shop card with staggered entrance ──────────────────────────────────────
function ShopCard({
  item,
  index,
  onPress,
  openLabel,
  closedLabel,
  minLabel,
}: {
  item: Shop;
  index: number;
  onPress: () => void;
  openLabel: string;
  closedLabel: string;
  minLabel: string;
}) {
  const opacity   = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(30)).current;

  const hasAnimated = useRef(false);
  useEffect(() => {
    if (hasAnimated.current) return;
    hasAnimated.current = true;
    Animated.parallel([
      Animated.timing(opacity, {
        toValue:         1,
        duration:        300,
        delay:           index * 60,
        useNativeDriver: true,
      }),
      Animated.timing(translate, {
        toValue:         0,
        duration:        300,
        delay:           index * 60,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translate, index]);

  const accent  = SHOP_PALETTE[index % SHOP_PALETTE.length];
  const initial = item.name.charAt(0).toUpperCase();

  return (
    <Animated.View
      style={{
        opacity,
        transform: [{ translateY: translate }],
      }}
    >
      <PressableScale onPress={onPress} scaleTo={0.98} style={styles.shopCard}>
        <View style={[styles.shopThumb, { backgroundColor: accent }]}>
          <Text
            color={Colors.white}
            style={styles.shopInitial}
          >
            {initial}
          </Text>
        </View>
        <View style={styles.shopBody}>
          <Text variant="h3" numberOfLines={1} style={styles.shopName}>
            {item.name}
          </Text>
          <Text
            variant="bodySmall"
            color={Colors.textSecondary}
            numberOfLines={1}
            style={styles.shopAddress}
          >
            {item.address}
          </Text>
          <View style={styles.shopChipsRow}>
            <View style={styles.timeChip}>
              <Text variant="caption" color={Colors.textSecondary}>
                🕐 {item.estimatedDeliveryMinutes} {minLabel}
              </Text>
            </View>
            <Badge
              label={item.isCurrentlyOpen ? openLabel : closedLabel}
              variant={item.isCurrentlyOpen ? 'success' : 'neutral'}
            />
          </View>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

// ─── Main screen ────────────────────────────────────────────────────────────
export default function HomeScreen({ navigation }: Props) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [shops,      setShops]      = useState<Shop[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(false);
  const [cartCount,  setCartCount]  = useState(0);

  // ── 5A. Screen entrance animations (run once on mount) ───────────────────
  const headerOpacity   = useRef(new Animated.Value(0)).current;
  const searchTranslate = useRef(new Animated.Value(20)).current;
  const searchOpacity   = useRef(new Animated.Value(0)).current;
  const bannerTranslate = useRef(new Animated.Value(20)).current;
  const bannerOpacity   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerOpacity, {
        toValue:         1,
        duration:        300,
        useNativeDriver: true,
      }),
      Animated.timing(searchOpacity, {
        toValue:         1,
        duration:        300,
        delay:           100,
        useNativeDriver: true,
      }),
      Animated.timing(searchTranslate, {
        toValue:         0,
        duration:        300,
        delay:           100,
        useNativeDriver: true,
      }),
      Animated.timing(bannerOpacity, {
        toValue:         1,
        duration:        300,
        delay:           200,
        useNativeDriver: true,
      }),
      Animated.timing(bannerTranslate, {
        toValue:         0,
        duration:        300,
        delay:           200,
        useNativeDriver: true,
      }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 5B. Cart badge animation (springs on count change) ───────────────────
  const badgeScale = useRef(new Animated.Value(cartCount > 0 ? 1 : 0)).current;
  const prevCartCount = useRef<number>(cartCount);

  useEffect(() => {
    const prev = prevCartCount.current;
    const curr = cartCount;
    if (prev === curr) return;

    if (prev === 0 && curr > 0) {
      // First item: scale 0 → 1 with bouncy spring
      Animated.spring(badgeScale, {
        toValue:         1,
        friction:        5,
        tension:         200,
        useNativeDriver: true,
      }).start();
    } else if (curr > prev) {
      // Increase: 1 → 1.6 → 1 bounce
      Animated.sequence([
        Animated.spring(badgeScale, {
          toValue:         1.6,
          friction:        4,
          tension:         300,
          useNativeDriver: true,
        }),
        Animated.spring(badgeScale, {
          toValue:         1,
          friction:        4,
          tension:         300,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (curr === 0) {
      // Last item removed: scale 1 → 0
      Animated.timing(badgeScale, {
        toValue:         0,
        duration:        150,
        useNativeDriver: true,
      }).start();
    }
    prevCartCount.current = curr;
  }, [cartCount, badgeScale]);

  const loadShops = useCallback(async () => {
    setError(false);
    try {
      const data = await api.getShops() as Shop[];
      setShops(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleRetry = useCallback(() => {
    setError(false);
    setLoading(true);
    void loadShops();
  }, [loadShops]);

  const loadCartCount = useCallback(async () => {
    try {
      const c = await api.getCart();
      setCartCount(c.items.reduce((s, i) => s + i.quantity, 0));
    } catch {
      setCartCount(0);
    }
  }, []);

  useEffect(() => { void loadShops(); }, [loadShops]);
  useFocusEffect(useCallback(() => { void loadCartCount(); }, [loadCartCount]));

  return (
    <View style={styles.container}>
      {/* ── 1. Header ─────────────────────────────────────────────────────── */}
      <Animated.View
        style={[
          styles.header,
          { paddingTop: insets.top + Spacing.md, opacity: headerOpacity },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <View style={styles.locationRow}>
              <Text variant="body" style={styles.locationPin}>📍</Text>
              <Text
                variant="h3"
                color={Colors.white}
                numberOfLines={1}
              >
                {t('home.location')}
              </Text>
            </View>
            <Text
              variant="bodySmall"
              color={Colors.white}
              style={styles.deliverySub}
            >
              {t('home.deliveryIn30')} ⚡
            </Text>
          </View>

          <PressableScale
            onPress={() => navigation.navigate('Cart')}
            scaleTo={0.9}
            style={styles.cartBtn}
            accessibilityLabel="Cart"
          >
            <Text variant="body" style={styles.cartEmoji}>🛒</Text>
            <Animated.View
              style={[styles.cartBadge, { transform: [{ scale: badgeScale }] }]}
              pointerEvents="none"
            >
              <Text
                color={Colors.white}
                style={styles.cartBadgeText}
              >
                {cartCount}
              </Text>
            </Animated.View>
          </PressableScale>
        </View>
      </Animated.View>

      {/* ── 2. Search bar — lives OUTSIDE the ScrollView so it is never
               clipped by the scroll container's top edge.
               marginTop: -20 on the wrapper pulls it 20 px up into the
               header's paddingBottom zone; the bar itself is fully visible
               and tappable because it is a normal-flow sibling view. ────── */}
      <Animated.View
        style={[
          styles.searchContainer,
          {
            opacity:   searchOpacity,
            transform: [{ translateY: searchTranslate }],
          },
        ]}
      >
        <TouchableOpacity
          style={styles.searchWrap}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('Search')}
        >
          <Text variant="body" style={styles.searchIcon}>🔍</Text>
          <Text style={styles.searchPlaceholder}>{t('home.searchPlaceholder')}</Text>
        </TouchableOpacity>
      </Animated.View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadShops();
              void loadCartCount();
            }}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
            progressViewOffset={insets.top + 40}
          />
        }
      >
        {/* ── 3. Promo banner ────────────────────────────────────────────── */}
        <Animated.View
          style={[
            styles.bannerOuter,
            {
              opacity:   bannerOpacity,
              transform: [{ translateY: bannerTranslate }],
            },
          ]}
        >
          <FauxGradient
            from="#FF3E6C"
            to="#FF8C42"
            style={styles.banner}
            steps={10}
          >
            <View style={{ flex: 1 }}>
              <Text variant="h3" color={Colors.white} style={styles.bannerTitle}>
                🚀 {t('home.quickCommerce')}
              </Text>
              <Text
                variant="bodySmall"
                color={Colors.white}
                style={styles.bannerSub}
              >
                {t('home.quickCommerceSub')}
              </Text>
            </View>
            <View style={{ width: 64 }} />
          </FauxGradient>
          <View pointerEvents="none" style={styles.bannerEmojiWrap}>
            <Text style={styles.bannerEmoji}>🛵</Text>
          </View>
          <View style={styles.dotsRow}>
            <View style={[styles.dot, styles.dotActive]} />
          </View>
        </Animated.View>

        {/* ── 4. Section header ──────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text variant="h2" style={styles.sectionTitle}>
            {t('home.shopsTitle')}
          </Text>
          <PressableScale onPress={() => {}} scaleTo={0.96}>
            <Text variant="label" color={Colors.primary}>
              {t('home.viewAll')}
            </Text>
          </PressableScale>
        </View>

        {/* ── 5/6/7/8. Skeleton / error / empty / list ───────────────────── */}
        {loading ? (
          <View style={styles.listGap}>
            <ShopCardSkeleton />
            <ShopCardSkeleton />
            <ShopCardSkeleton />
          </View>
        ) : error && shops.length === 0 ? (
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
        ) : shops.length === 0 ? (
          <View style={styles.empty}>
            <Text variant="hero" style={styles.emptyEmoji}>🏪</Text>
            <Text variant="h3" align="center" color={Colors.textPrimary}>
              {t('home.noShops')}
            </Text>
            <Text
              variant="body"
              align="center"
              color={Colors.textSecondary}
              style={styles.emptyHint}
            >
              {t('home.deliveryIn30')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={shops}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
            renderItem={({ item, index }) => (
              <ShopCard
                item={item}
                index={index}
                onPress={() =>
                  navigation.navigate('ShopDetail', {
                    shopId:   item.id,
                    shopName: item.name,
                  })
                }
                openLabel={t('home.open')}
                closedLabel={t('home.closed')}
                minLabel={t('home.min')}
              />
            )}
          />
        )}

        <View style={{ height: Spacing.huge }} />
      </ScrollView>
    </View>
  );
}

const HEADER_BLEED = 28;
const SEARCH_HEIGHT = 48;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // 1. Header
  header: {
    backgroundColor:        Colors.primary,
    paddingHorizontal:      Spacing.lg,
    paddingBottom:          HEADER_BLEED,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.md,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.xs,
  },
  locationPin: {
    fontSize: 18,
  },
  deliverySub: {
    marginTop: 2,
    opacity:   0.92,
  },
  cartBtn: {
    width:           44,
    height:          44,
    borderRadius:    Radius.full,
    backgroundColor: Colors.white,
    justifyContent:  'center',
    alignItems:      'center',
  },
  cartEmoji: { fontSize: 22 },
  cartBadge: {
    position:        'absolute',
    top:             -4,
    right:           -4,
    minWidth:        20,
    height:          20,
    borderRadius:    10,
    backgroundColor: Colors.error,
    paddingHorizontal: 4,
    justifyContent:  'center',
    alignItems:      'center',
    borderWidth:     2,
    borderColor:     Colors.white,
  },
  cartBadgeText: {
    fontSize:   FontSize.xxs,
    fontWeight: FontWeight.black,
    lineHeight: 12,
  },

  // Scroll
  scrollContent: {
    paddingBottom: Spacing.xxxl,
  },

  // 2. Search
  searchContainer: {
    marginTop: -20,
  },
  searchWrap: {
    flexDirection:    'row',
    alignItems:       'center',
    backgroundColor:  Colors.surface,
    marginHorizontal: Spacing.lg,
    height:           SEARCH_HEIGHT,
    borderRadius:     Radius.xl,
    paddingHorizontal: Spacing.lg,
    ...Shadow.md,
  },
  searchIcon: {
    fontSize:    16,
    marginRight: Spacing.sm,
    color:       Colors.textTertiary,
  },
  searchPlaceholder: {
    flex:      1,
    fontSize:  FontSize.md,
    color:     Colors.textTertiary,
    lineHeight: SEARCH_HEIGHT,
  },

  // 3. Banner
  bannerOuter: {
    marginTop: Spacing.lg,
    overflow: 'visible',
  },
  banner: {
    flexDirection:    'row',
    alignItems:       'center',
    padding:          Spacing.xl,
    marginHorizontal: Spacing.lg,
    borderRadius:     Radius.xl,
    gap:              Spacing.md,
    overflow:         'hidden',
    ...Shadow.md,
  },
  bannerTitle: { lineHeight: 24 },
  bannerSub:   { marginTop: 4, opacity: 0.94 },
  bannerEmojiWrap: {
    position: 'absolute',
    right: Spacing.xl,
    bottom: 24,
    overflow: 'visible',
  },
  bannerEmoji: { fontSize: 56, lineHeight: 78, includeFontPadding: false },
  dotsRow: {
    flexDirection:  'row',
    justifyContent: 'center',
    gap:            Spacing.xs,
    marginTop:      Spacing.md,
  },
  dot: {
    width:           6,
    height:          6,
    borderRadius:    3,
    backgroundColor: Colors.border,
  },
  dotActive: {
    width:           18,
    backgroundColor: Colors.primary,
  },

  // 4. Section header
  sectionHeader: {
    flexDirection:    'row',
    justifyContent:   'space-between',
    alignItems:       'center',
    marginHorizontal: Spacing.lg,
    marginTop:        Spacing.xl,
    marginBottom:     Spacing.md,
  },
  sectionTitle: {
    fontSize: FontSize.xl,
  },

  // 5. Shop card
  listGap: {
    gap: Spacing.sm,
  },
  shopCard: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              Spacing.md,
    backgroundColor:  Colors.surface,
    marginHorizontal: Spacing.lg,
    borderRadius:     Radius.xl,
    paddingVertical:  Spacing.lg,
    paddingHorizontal: Spacing.lg,
    ...Shadow.md,
  },
  shopThumb: {
    width:          80,
    height:         80,
    borderRadius:   Radius.lg,
    justifyContent: 'center',
    alignItems:     'center',
  },
  shopInitial: {
    fontSize:   FontSize.xxxl,
    fontWeight: FontWeight.black,
    lineHeight: 36,
  },
  shopBody: {
    flex: 1,
    gap:  Spacing.xs,
  },
  shopName: {
    fontSize: FontSize.lg,
  },
  shopAddress: {
    marginTop: 0,
  },
  shopChipsRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.sm,
    marginTop:     Spacing.xs,
    flexWrap:      'wrap',
  },
  timeChip: {
    backgroundColor:   Colors.surfaceAlt,
    paddingHorizontal: Spacing.sm,
    paddingVertical:   Spacing.xxs,
    borderRadius:      Radius.full,
  },

  // 7. Empty
  empty: {
    alignItems:        'center',
    marginTop:         80,
    paddingHorizontal: Spacing.xxl,
    gap:               Spacing.sm,
  },
  emptyEmoji: { fontSize: 64, marginBottom: Spacing.sm },
  emptyHint:  { marginTop: Spacing.xs },

  // 8. Error state
  errorContainer: {
    flex:              1,
    justifyContent:    'center',
    alignItems:        'center',
    padding:           32,
    gap:               12,
    marginTop:         60,
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
