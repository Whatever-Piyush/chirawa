import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions, FlatList, Image, StyleSheet, TouchableOpacity, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { FoodMenuItem, FoodRestaurantDetail, FoodRestaurantSummary } from '@chirawa/types';
import { useT } from '@chirawa/i18n';
import { Text, Shimmer, FauxGradient, RatingBadge } from '../../components/ui';
import FoodMenuItemCard from '../../components/food/FoodMenuItemCard';
import { Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { api } from '../../services/api.service';
import { useFoodCart } from '../../context/FoodCartContext';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import {
  FOOD_ACCENT, FOOD_ACCENT_SOFT, FOOD_HEADER_FROM, FOOD_HEADER_TO, foodGradient,
} from './foodTheme';

// ─── Food landing — two-pane (Food.md §8.2) ───────────────────────────────────
// Left rail: the curated restaurants in their manual displayOrder (single-pane
// scroll). Right: the active restaurant's menu, scrolling in rows of two.
// Header carries the DECIDED copy + the config-driven 30–50 min ETA band.
// Reuses the ShopDetailScreen two-pane geometry; that screen is untouched.

const { width: SCREEN_W } = Dimensions.get('window');
const RAIL_W    = 92;
const GRID_PAD  = 8;
const GRID_GAP  = 8;
const CARD_W    = (SCREEN_W - RAIL_W - GRID_PAD * 2 - GRID_GAP) / 2;

type Navigation = NativeStackNavigationProp<RootStackParamList>;

// Mixed right-pane rows: section headers between rows-of-two.
type MenuRow =
  | { type: 'section'; key: string; name: string }
  | { type: 'items'; key: string; items: FoodMenuItem[] };

function buildMenuRows(detail: FoodRestaurantDetail | null): MenuRow[] {
  if (!detail) return [];
  const rows: MenuRow[] = [];
  for (const section of detail.menuSections) {
    rows.push({ type: 'section', key: `s-${section.id}`, name: section.name });
    for (let i = 0; i < section.items.length; i += 2) {
      rows.push({ type: 'items', key: `i-${section.id}-${i}`, items: section.items.slice(i, i + 2) });
    }
  }
  return rows;
}

export default function FoodScreen() {
  const t = useT();
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const { count, subtotalPaise } = useFoodCart();

  const [restaurants, setRestaurants] = useState<FoodRestaurantSummary[]>([]);
  const [eta, setEta]                 = useState({ minMinutes: 30, maxMinutes: 50 });
  const [railLoading, setRailLoading] = useState(true);
  const [railError, setRailError]     = useState(false);

  const [activeId, setActiveId]       = useState<string | null>(null);
  const [detail, setDetail]           = useState<FoodRestaurantDetail | null>(null);
  const [menuLoading, setMenuLoading] = useState(false);
  const detailCache = useRef<Map<string, FoodRestaurantDetail>>(new Map());

  const loadRestaurants = useCallback(async () => {
    setRailError(false);
    setRailLoading(true);
    try {
      const res = await api.getFoodRestaurants();
      setRestaurants(res.restaurants);
      setEta(res.eta);
      // Auto-open the first restaurant (manual launch order #1 = Aura).
      setActiveId((prev) => prev ?? res.restaurants[0]?.id ?? null);
    } catch {
      setRailError(true);
    } finally {
      setRailLoading(false);
    }
  }, []);

  useEffect(() => { void loadRestaurants(); }, [loadRestaurants]);

  // Load (or read cached) menu whenever the active restaurant changes.
  useEffect(() => {
    if (!activeId) return;
    const cached = detailCache.current.get(activeId);
    if (cached) { setDetail(cached); return; }
    let active = true;
    setMenuLoading(true);
    setDetail(null);
    api.getFoodRestaurant(activeId)
      .then((d) => {
        if (!active) return;
        detailCache.current.set(activeId, d);
        setDetail(d);
      })
      .catch(() => { if (active) setDetail(null); })
      .finally(() => { if (active) setMenuLoading(false); });
    return () => { active = false; };
  }, [activeId]);

  const menuRows = useMemo(() => buildMenuRows(detail), [detail]);
  const activeRestaurant = useMemo(
    () => restaurants.find((r) => r.id === activeId) ?? null,
    [restaurants, activeId],
  );

  const etaLine = t('food.headerEta')
    .replace('{min}', String(eta.minMinutes))
    .replace('{max}', String(eta.maxMinutes));

  const renderRailItem = useCallback(({ item, index }: { item: FoodRestaurantSummary; index: number }) => {
    const active = item.id === activeId;
    const [from, to] = foodGradient(index);
    return (
      <TouchableOpacity
        style={[styles.railItem, active && styles.railItemActive]}
        activeOpacity={0.7}
        onPress={() => setActiveId(item.id)}
        accessibilityRole="button"
        accessibilityState={active ? { selected: true } : {}}
        accessibilityLabel={item.name}
      >
        {active && <View style={styles.railBar} />}
        {item.logoUrl ? (
          <Image source={{ uri: item.logoUrl }} style={styles.railThumbImg} />
        ) : (
          <FauxGradient from={from} to={to} style={styles.railThumb}>
            <Text weight="bold" color={Colors.white} style={styles.railThumbText}>
              {item.name.charAt(0).toUpperCase()}
            </Text>
          </FauxGradient>
        )}
        <Text
          weight={active ? 'bold' : 'regular'}
          color={active ? FOOD_ACCENT : Colors.textSecondary}
          numberOfLines={2}
          style={styles.railLabel}
        >
          {item.name}
        </Text>
        {!item.isCurrentlyOpen && (
          <View style={styles.closedPill}>
            <Text weight="semibold" color={Colors.white} style={styles.closedPillText}>
              {t('food.closed')}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }, [activeId, styles, Colors, t]);

  const renderMenuRow = useCallback(({ item }: { item: MenuRow }) => {
    if (item.type === 'section') {
      return (
        <View style={styles.sectionHeader}>
          <View style={styles.sectionRule} />
          <Text weight="semibold" color={Colors.textSecondary} style={styles.sectionName}>
            {item.name}
          </Text>
          <View style={styles.sectionRule} />
        </View>
      );
    }
    return (
      <View style={styles.gridRow}>
        {item.items.map((m) => (
          <FoodMenuItemCard key={m.id} item={m} width={CARD_W} />
        ))}
      </View>
    );
  }, [styles, Colors]);

  return (
    <View style={styles.container}>
      {/* ── Header — decided copy + ETA band (Food.md §8.2) ─────────────────── */}
      <FauxGradient from={FOOD_HEADER_FROM} to={FOOD_HEADER_TO} style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <View style={styles.headerTopRow}>
          <View style={styles.eyebrow}>
            <Ionicons name="restaurant" size={11} color={Colors.white} />
            <Text weight="semibold" color={Colors.white} style={styles.eyebrowText}>
              {t('food.tabFood')}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('FoodOrders')}
            style={styles.ordersBtn}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('food.myFoodOrders')}
          >
            <Ionicons name="receipt-outline" size={16} color={Colors.white} />
          </TouchableOpacity>
        </View>
        <Text weight="bold" color={Colors.white} style={styles.title}>
          {t('food.headerTitle')}
        </Text>
        <View style={styles.etaBand}>
          <Ionicons name="time-outline" size={13} color={Colors.white} />
          <Text weight="semibold" color={Colors.white} style={styles.etaText}>
            {etaLine}
          </Text>
        </View>
      </FauxGradient>

      {/* ── Two-pane body ────────────────────────────────────────────────────── */}
      <View style={styles.body}>
        {/* Left rail — restaurants, manual launch order */}
        <View style={styles.rail}>
          {railLoading ? (
            <View style={styles.railSkeleton}>
              {Array.from({ length: 6 }).map((_, i) => (
                <View key={i} style={styles.railSkeletonItem}>
                  <Shimmer width={52} height={52} borderRadius={Radius.md} />
                  <Shimmer width={60} height={10} />
                </View>
              ))}
            </View>
          ) : railError ? (
            <TouchableOpacity style={styles.railRetry} onPress={() => void loadRestaurants()} activeOpacity={0.8}>
              <Ionicons name="refresh" size={20} color={FOOD_ACCENT} />
            </TouchableOpacity>
          ) : (
            <FlatList
              data={restaurants}
              keyExtractor={(r) => r.id}
              renderItem={renderRailItem}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.railList}
            />
          )}
        </View>

        {/* Right pane — active restaurant's menu in rows of two */}
        <View style={styles.grid}>
          {activeRestaurant && (
            <View style={styles.activeBar}>
              <View style={{ flex: 1 }}>
                <Text weight="bold" color={Colors.textPrimary} numberOfLines={1} style={styles.activeName}>
                  {activeRestaurant.name}
                </Text>
                <Text weight="regular" color={Colors.textSecondary} numberOfLines={1} style={styles.activeMeta}>
                  {activeRestaurant.cuisine ?? ''}
                  {activeRestaurant.isCurrentlyOpen
                    ? `  ·  ${t('food.open')}`
                    : `  ·  ${t('food.opensAt').replace('{time}', activeRestaurant.openTime)}`}
                </Text>
              </View>
              <RatingBadge
                average={activeRestaurant.rating.average}
                count={activeRestaurant.rating.count}
                size={12}
                showCount={false}
              />
            </View>
          )}

          {menuLoading ? (
            <View style={styles.gridPad}>
              {Array.from({ length: 3 }).map((_, r) => (
                <View key={r} style={styles.gridRow}>
                  <Shimmer width={CARD_W} height={170} borderRadius={Radius.lg} />
                  <Shimmer width={CARD_W} height={170} borderRadius={Radius.lg} />
                </View>
              ))}
            </View>
          ) : detail && detail.menuAvailable ? (
            <FlatList
              key={activeId}                 // reset scroll when switching restaurant
              data={menuRows}
              keyExtractor={(row) => row.key}
              renderItem={renderMenuRow}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.gridPad, count > 0 && { paddingBottom: 120 }]}
            />
          ) : (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="restaurant-outline" size={30} color={FOOD_ACCENT} />
              </View>
              <Text weight="bold" color={Colors.textPrimary} style={styles.emptyTitle}>
                {t('food.menuComingSoon')}
              </Text>
              <Text weight="regular" color={Colors.textSecondary} align="center" style={styles.emptyCopy}>
                {t('food.menuComingSoonDesc')}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* ── Food cart bar — floats above the tab bar when the cart has items ── */}
      {count > 0 && (
        <TouchableOpacity
          style={[styles.cartBar, { bottom: Spacing.md }]}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('FoodCheckout')}
          accessibilityRole="button"
          accessibilityLabel={t('food.viewCart')}
        >
          <View style={styles.cartBarLeft}>
            <Ionicons name="bag-handle" size={18} color={Colors.white} />
            <Text weight="semibold" color={Colors.white} style={styles.cartBarText}>
              {count} {count === 1 ? t('food.item') : t('food.items')} · ₹{Math.round(subtotalPaise / 100)}
            </Text>
          </View>
          <View style={styles.cartBarRight}>
            <Text weight="bold" color={Colors.white} style={styles.cartBarText}>
              {t('food.viewCart')}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.white} />
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },

    header: {
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.lg,
    },
    headerTopRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: Spacing.sm,
    },
    eyebrow: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 10, paddingVertical: 5,
      borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.18)',
    },
    eyebrowText: { fontSize: 11, lineHeight: 14, letterSpacing: 0.3 },
    ordersBtn: {
      width: 32, height: 32, borderRadius: 16,
      backgroundColor: 'rgba(255,255,255,0.18)',
      alignItems: 'center', justifyContent: 'center',
    },
    title: { fontSize: 19, lineHeight: 25, maxWidth: 330 },
    etaBand: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      alignSelf: 'flex-start',
      marginTop: Spacing.sm,
      paddingHorizontal: 10, paddingVertical: 6,
      borderRadius: Radius.full,
      backgroundColor: 'rgba(0,0,0,0.25)',
    },
    etaText: { fontSize: 11, lineHeight: 14 },

    body: { flex: 1, flexDirection: 'row' },

    rail: {
      width: RAIL_W,
      backgroundColor: Colors.surfaceAlt,
      borderRightWidth: 1, borderRightColor: Colors.border,
    },
    railList: { paddingVertical: Spacing.sm },
    railSkeleton: { paddingVertical: Spacing.md, alignItems: 'center', gap: Spacing.lg },
    railSkeletonItem: { alignItems: 'center', gap: 6 },
    railRetry: { paddingVertical: Spacing.xl, alignItems: 'center' },
    railItem: {
      paddingVertical: Spacing.md, paddingHorizontal: 6,
      alignItems: 'center', gap: 5,
    },
    railItemActive: { backgroundColor: Colors.surface },
    railBar: {
      position: 'absolute', left: 0, top: 8, bottom: 8, width: 3,
      borderTopRightRadius: 3, borderBottomRightRadius: 3,
      backgroundColor: FOOD_ACCENT,
    },
    railThumb: {
      width: 52, height: 52, borderRadius: Radius.md,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    },
    railThumbImg: { width: 52, height: 52, borderRadius: Radius.md },
    railThumbText: { fontSize: 22 },
    railLabel: { fontSize: 10, lineHeight: 13, textAlign: 'center' },
    closedPill: {
      paddingHorizontal: 6, paddingVertical: 2,
      borderRadius: Radius.full, backgroundColor: 'rgba(0,0,0,0.55)',
    },
    closedPillText: { fontSize: 8, lineHeight: 10 },

    grid: { flex: 1 },
    activeBar: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
      paddingHorizontal: GRID_PAD + 2, paddingVertical: Spacing.sm,
      borderBottomWidth: 1, borderBottomColor: Colors.border,
      backgroundColor: Colors.surface,
    },
    activeName: { fontSize: 14, lineHeight: 18 },
    activeMeta: { fontSize: 10, lineHeight: 14 },
    gridPad: { padding: GRID_PAD, paddingBottom: Spacing.xxxl },
    gridRow: { flexDirection: 'row', gap: GRID_GAP, marginBottom: GRID_GAP },
    sectionHeader: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
      paddingVertical: Spacing.sm, paddingHorizontal: 2,
    },
    sectionRule: { flex: 1, height: 1, backgroundColor: Colors.border },
    sectionName: { fontSize: 11, lineHeight: 14, letterSpacing: 0.4, textTransform: 'uppercase' },

    empty: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      paddingHorizontal: Spacing.xl, gap: Spacing.sm,
    },
    emptyIcon: {
      width: 60, height: 60, borderRadius: 24,
      backgroundColor: FOOD_ACCENT_SOFT,
      alignItems: 'center', justifyContent: 'center',
      marginBottom: Spacing.xs,
    },
    emptyTitle: { fontSize: 15, lineHeight: 20 },
    emptyCopy: { fontSize: 12, lineHeight: 17, maxWidth: 220 },

    cartBar: {
      position: 'absolute', left: Spacing.lg, right: Spacing.lg,
      height: 52, borderRadius: Radius.xl,
      backgroundColor: FOOD_ACCENT,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: Spacing.lg,
      ...Shadow.md,
    },
    cartBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    cartBarRight: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    cartBarText: { fontSize: 13, lineHeight: 17 },
  });
