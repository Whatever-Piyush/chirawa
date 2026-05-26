import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  RefreshControl, TextInput, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, Radius, Shadow, Gradients } from '../../theme';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';
import PressableScale from '../../components/ui/PressableScale';
import Shimmer from '../../components/ui/Shimmer';
import FauxGradient from '../../components/ui/FauxGradient';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'MainTabs'> };

interface Shop {
  id: string; name: string; description: string | null;
  estimatedDeliveryMinutes: number; isCurrentlyOpen: boolean;
  address: string; logoUrl: string | null;
}

const CATEGORIES = [
  { emoji: '🥦', key: 'home.catVegetables' },
  { emoji: '🍎', key: 'home.catFruits' },
  { emoji: '🥛', key: 'home.catDairy' },
  { emoji: '🧴', key: 'home.catHousehold' },
  { emoji: '💊', key: 'home.catMedicines' },
] as const;

// Distinct shop-card accent gradients so each card feels unique
const SHOP_ACCENTS: ReadonlyArray<readonly [string, string]> = [
  ['#FF3E6C', '#FF8C42'],
  ['#7C5CFF', '#FF6BD9'],
  ['#00B894', '#55D17C'],
  ['#FDCB6E', '#FF8C42'],
  ['#2D9CDB', '#56CCF2'],
];

function ShopCardSkeleton() {
  return (
    <View style={skeletonStyles.card}>
      <Shimmer width={72} height={72} borderRadius={Radius.md} />
      <View style={skeletonStyles.body}>
        <Shimmer width="65%" height={16} />
        <View style={{ height: 8 }} />
        <Shimmer width="40%" height={12} />
        <View style={{ height: 8 }} />
        <Shimmer width="55%" height={12} />
      </View>
    </View>
  );
}

export default function HomeScreen({ navigation }: Props) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [shops,     setShops]     = useState<Shop[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,    setSearch]    = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [cartCount, setCartCount] = useState(0);

  const loadShops = useCallback(async () => {
    try {
      const data = await api.getShops() as Shop[];
      setShops(data);
    } catch (err) {
      console.error('Failed to load shops:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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

  const filtered = shops.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <View style={styles.container}>
      {/* ── Gradient header ─────────────────────────────────────────────── */}
      <FauxGradient
        from={Gradients.primary[0]}
        to={Gradients.primary[1]}
        style={[styles.headerGradient, { paddingTop: insets.top + Spacing.lg }]}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <View style={styles.locationRow}>
              <Text style={styles.locationPin}>📍</Text>
              <Text style={styles.locationText}>{t('home.location')}</Text>
            </View>
            <View style={styles.deliveryChip}>
              <Text style={styles.deliveryChipText}>⚡  {t('home.deliveryIn30')}</Text>
            </View>
          </View>
          <PressableScale
            style={styles.cartBtn}
            onPress={() => navigation.navigate('Cart')}
          >
            <Text style={styles.cartEmoji}>🛒</Text>
            {cartCount > 0 && (
              <View style={styles.cartBadge}>
                <Text style={styles.cartBadgeText}>{cartCount}</Text>
              </View>
            )}
          </PressableScale>
        </View>
      </FauxGradient>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); void loadShops(); void loadCartCount(); }}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
          />
        }
      >
        {/* ── Search pill ───────────────────────────────────────────────── */}
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder={t('home.searchPlaceholder')}
            placeholderTextColor={Colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
        </View>

        {/* ── Category chips ────────────────────────────────────────────── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {CATEGORIES.map((c) => {
            const active = activeCat === c.key;
            return (
              <PressableScale
                key={c.key}
                onPress={() => setActiveCat(active ? null : c.key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={styles.chipEmoji}>{c.emoji}</Text>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {t(c.key)}
                </Text>
              </PressableScale>
            );
          })}
        </ScrollView>

        {/* ── Promo banner ─────────────────────────────────────────────── */}
        <View style={styles.bannerWrap}>
          <FauxGradient
            from={Gradients.warm[0]}
            to={Gradients.warm[1]}
            style={styles.banner}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>🚀 {t('home.quickCommerce')}</Text>
              <Text style={styles.bannerSub}>{t('home.quickCommerceSub')}</Text>
            </View>
            <Text style={styles.bannerEmoji}>🛵</Text>
          </FauxGradient>
        </View>

        {/* ── Shop list ─────────────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>{t('home.shopsTitle')}</Text>

        {loading ? (
          <View style={{ gap: Spacing.md }}>
            <ShopCardSkeleton />
            <ShopCardSkeleton />
            <ShopCardSkeleton />
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🏪</Text>
            <Text style={styles.emptyText}>{t('home.noShops')}</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
            renderItem={({ item, index }) => {
              const accent = SHOP_ACCENTS[index % SHOP_ACCENTS.length] as readonly [string, string];
              const initial = item.name.charAt(0).toUpperCase();
              return (
                <PressableScale
                  onPress={() =>
                    navigation.navigate('ShopDetail', { shopId: item.id, shopName: item.name })
                  }
                  scaleTo={0.98}
                  style={styles.shopCard}
                >
                  <FauxGradient
                    from={accent[0]}
                    to={accent[1]}
                    style={styles.shopThumb}
                  >
                    <Text style={styles.shopInitial}>{initial}</Text>
                  </FauxGradient>
                  <View style={styles.shopBody}>
                    <View style={styles.shopRow}>
                      <Text style={styles.shopName} numberOfLines={1}>{item.name}</Text>
                      <View style={[
                        styles.openBadge,
                        { backgroundColor: item.isCurrentlyOpen ? Colors.accent : Colors.textMuted },
                      ]}>
                        <Text style={styles.openBadgeText}>
                          {item.isCurrentlyOpen ? t('home.open') : t('home.closed')}
                        </Text>
                      </View>
                    </View>
                    {item.description ? (
                      <Text style={styles.shopDesc} numberOfLines={1}>{item.description}</Text>
                    ) : null}
                    <View style={styles.shopMeta}>
                      <Text style={styles.shopMetaText}>
                        🕐 {item.estimatedDeliveryMinutes} {t('home.min')}
                      </Text>
                      <Text style={styles.shopMetaDot}>·</Text>
                      <Text style={styles.shopMetaText} numberOfLines={1}>
                        📍 {item.address}
                      </Text>
                    </View>
                  </View>
                </PressableScale>
              );
            }}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  headerGradient: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    borderBottomLeftRadius:  Radius.xl,
    borderBottomRightRadius: Radius.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationPin:  { fontSize: 18 },
  locationText: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.white },
  deliveryChip: {
    marginTop: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  deliveryChipText: {
    color: Colors.white,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
  cartBtn: {
    width: 44, height: 44,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: Radius.full,
    justifyContent: 'center', alignItems: 'center',
  },
  cartEmoji: { fontSize: 22 },
  cartBadge: {
    position: 'absolute',
    top: -2, right: -2,
    backgroundColor: Colors.error,
    minWidth: 18, height: 18, borderRadius: 9,
    paddingHorizontal: 4,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: Colors.white,
  },
  cartBadgeText: {
    color: Colors.white, fontSize: 10, fontWeight: '800',
  },

  // Scroll body
  scroll: {
    paddingBottom: Spacing.xxxl,
    marginTop: -Spacing.lg,
  },

  // Search
  searchBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.white,
    marginHorizontal: Spacing.lg,
    marginTop: -Spacing.lg,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
    ...Shadow.card,
  },
  searchIcon:  { fontSize: 16, marginRight: Spacing.sm, color: Colors.primary },
  searchInput: { flex: 1, height: 48, fontSize: FontSize.md, color: Colors.text },

  // Category chips
  chipRow: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.white,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  chipEmoji: { fontSize: 16 },
  chipText:  { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  chipTextActive: { color: Colors.white },

  // Banner
  bannerWrap: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.strong,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  bannerTitle: { fontSize: FontSize.lg, fontWeight: '900', color: Colors.white },
  bannerSub:   { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.92)', marginTop: 2 },
  bannerEmoji: { fontSize: 52 },

  // Shops
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: '800',
    color: Colors.text,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  shopCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    flexDirection: 'row',
    gap: Spacing.md,
    marginHorizontal: Spacing.lg,
    alignItems: 'center',
    ...Shadow.card,
  },
  shopThumb: {
    width: 64, height: 64,
    borderRadius: Radius.md,
    justifyContent: 'center', alignItems: 'center',
  },
  shopInitial: {
    fontSize: 30,
    fontWeight: '900',
    color: Colors.white,
  },
  shopBody: { flex: 1, gap: 4 },
  shopRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  shopName: { flex: 1, fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  openBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: Radius.full,
  },
  openBadgeText: { color: Colors.white, fontSize: FontSize.xs, fontWeight: '800' },
  shopDesc: { fontSize: FontSize.sm, color: Colors.textLight },
  shopMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  shopMetaText: { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '600' },
  shopMetaDot:  { color: Colors.textMuted },

  // Empty
  empty: {
    alignItems: 'center',
    marginTop: 80,
    gap: Spacing.md,
    paddingHorizontal: Spacing.xxl,
  },
  emptyEmoji: { fontSize: 64 },
  emptyText:  { fontSize: FontSize.lg, color: Colors.textLight, textAlign: 'center' },
});

const skeletonStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: Spacing.md,
    backgroundColor: Colors.card,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.lg,
    alignItems: 'center',
    ...Shadow.card,
  },
  body: { flex: 1, justifyContent: 'center' },
});
