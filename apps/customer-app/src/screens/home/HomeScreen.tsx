import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, FlatList, StyleSheet,
  RefreshControl, TouchableOpacity, ScrollView, Animated,
} from 'react-native';
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
} from '../../components/ui';
import Header from './Header';
import SearchBar from './SearchBar';
import CategoryTabs from './CategoryTabs';
import FeaturedBanner from './FeaturedBanner';
import BestsellersSection from './BestsellersSection';
import CategoryGrid, { GROCERY_KITCHEN, SNACKS_DRINKS } from './CategoryGrid';
import ChirawaSpecialSection from './ChirawaSpecialSection';

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

  // ── Screen entrance animations (run once on mount) ───────────────────────
  // headerOpacity drives the new <Header /> fade-in; search and banner each
  // get an opacity + translateY pair so they slide in just after the header.
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

  useEffect(() => { void loadShops(); }, [loadShops]);

  return (
    <View style={styles.container}>
      {/* ── 1. Header — Bringly + cycling tagline + profile icon ─────────── */}
      <Header
        entranceOpacity={headerOpacity}
        onProfilePress={() => navigation.navigate('MainTabs', { screen: 'Profile' })}
      />

      {/* ── 2. Search bar — lives OUTSIDE the ScrollView so it is never
               clipped by the scroll container's top edge. The wrapper's
               marginTop: -20 pulls it up into the header's paddingBottom
               zone for the half-on-orange / half-on-cream overlap. */}
      <View style={styles.searchOverlap}>
        <SearchBar
          entranceOpacity={searchOpacity}
          entranceTranslate={searchTranslate}
          onPress={() => navigation.navigate('Search')}
        />
      </View>

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
            }}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
            progressViewOffset={insets.top + 40}
          />
        }
      >
        {/* ── 3. Category chips ──────────────────────────────────────────── */}
        <CategoryTabs />

        {/* ── 4. Featured banner — delivery promise ──────────────────────── */}
        <FeaturedBanner
          entranceOpacity={bannerOpacity}
          entranceTranslate={bannerTranslate}
        />

        {/* ── 5. Bestsellers — 3-column colored category cards ──────────── */}
        <BestsellersSection />

        {/* ── 6. Grocery & Kitchen — 4-column icon tiles ─────────────────── */}
        <CategoryGrid title={t('home.groceryKitchen')} items={GROCERY_KITCHEN} />

        {/* ── 7. Snacks & Drinks — 4-column icon tiles ───────────────────── */}
        <CategoryGrid title={t('home.snacksDrinks')} items={SNACKS_DRINKS} />

        {/* ── 8. Chirawa's Special — local-shops carousel (signature) ─────── */}
        <ChirawaSpecialSection />

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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Scroll
  scrollContent: {
    paddingBottom: Spacing.xxxl,
  },

  // 2. Search overlap — pulls the SearchBar up into the orange header's
  // bottom padding zone so the bar straddles the orange/cream boundary.
  searchOverlap: {
    marginTop: -20,
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
