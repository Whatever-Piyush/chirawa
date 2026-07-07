import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl, Animated, Linking } from 'react-native';
import * as Location from 'expo-location';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AddressResponse } from '@chirawa/types';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { useStoreClosed } from '../../hooks/useStoreClosed';
import { api } from '../../services/api.service';
import { fetchCategories, fetchDailyEssentials, fetchBestsellers, fetchCategoryImages, type ApiCategory, type BestsellerCluster } from '../../services/catalog';
import type { ProductCardData } from '../../components/product/ProductCard';
import { useAuth } from '../../context/AuthContext';
import { useAddresses } from '../../context/AddressContext';
import LocationSheet from '../../components/location/LocationSheet';
import LocationPermissionModal from '../../components/location/LocationPermissionModal';
import { useActiveOrders } from '../../hooks/useActiveOrders';
import ActiveOrdersStrip from './ActiveOrdersStrip';
import Header from './Header';
import SearchBar from './SearchBar';
import DailyEssentialsShelf from './DailyEssentialsShelf';
import BestsellersSection from './BestsellersSection';
import CategorySections from './CategorySections';
import ClosedBanner from './ClosedBanner';
import { SECTION_GROUPS } from './categoryMeta';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'MainTabs'> };

// Aggregated-feed home: a fixed header + search, then the scrolling sections —
// Daily Essentials (top-selling SKU rail) · Bestsellers (image clusters) ·
// category grids. All sections are bounded, so a ScrollView is the right container.
export default function HomeScreen({ navigation }: Props) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const { state } = useAuth();

  // Active delivery address comes from the global context — switching it anywhere
  // (sheet, My Addresses) updates this header instantly.
  const { current: activeAddress, refresh: loadAddresses } = useAddresses();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  // Real product images per category for the tiles (image-2 / 2.md).
  const [categoryImages, setCategoryImages] = useState<Record<string, string[]>>({});

  // Daily Essentials (TOP_SELLING_SKUS.md) — the curated everyday top-selling
  // SKUs, ordered by buy-frequency, drawn from the aggregated feed server-side.
  const [essentials, setEssentials] = useState<ProductCardData[]>([]);
  const [essLoading, setEssLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Bestsellers 2×2 cluster cards (image-1 / 1.md) — up to 4 sample product
  // images per category, eggs excluded, no counts (all server-side).
  const [bestsellers, setBestsellers] = useState<BestsellerCluster[]>([]);

  // Outside delivery hours the header + banner go night-themed and cart actions
  // disable gracefully (shared hook handles the open↔close transition).
  const closed = useStoreClosed();

  // piyush: app-open "location off" prompt.
  const [permModal, setPermModal] = useState(false);

  // Milestone A1: orders in flight — pinned to the top of the feed so tracking
  // is always one tap away after any restart/return (live via the user socket).
  const { entries: activeOrders, refresh: refreshActiveOrders } = useActiveOrders();

  const loadEssentials = useCallback(async () => {
    try {
      setEssentials(await fetchDailyEssentials());
    } catch {
      /* tolerate — rail hides; category browse still works */
    } finally {
      setEssLoading(false);
    }
  }, []);

  const loadBestsellers = useCallback(async () => {
    try { setBestsellers(await fetchBestsellers()); }
    catch { /* tolerate — section collapses */ }
  }, []);

  const loadCategoryImages = useCallback(async () => {
    try { setCategoryImages(await fetchCategoryImages()); }
    catch { /* tolerate — tiles fall back to emoji */ }
  }, []);

  useEffect(() => {
    void loadAddresses(); void loadEssentials(); void loadBestsellers(); void loadCategoryImages();
  }, [loadAddresses, loadEssentials, loadBestsellers, loadCategoryImages]);
  useEffect(
    () => navigation.addListener('focus', () => {
      void loadAddresses();
      void refreshActiveOrders();
    }),
    [navigation, loadAddresses, refreshActiveOrders],
  );

  // On app open, prompt to enable location if permission is off (once per mount).
  useEffect(() => {
    let active = true;
    Location.getForegroundPermissionsAsync()
      .then(({ granted }) => { if (active && !granted) setPermModal(true); })
      .catch(() => { /* tolerate */ });
    return () => { active = false; };
  }, []);

  const handleEnableLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') void Linking.openSettings();
    } catch {
      /* tolerate */
    } finally {
      setPermModal(false);
    }
  }, []);

  const handleSelectManually = useCallback(() => {
    setPermModal(false);
    setSheetOpen(true);
  }, []);

  // Load categories once. Keep only the known/curated categories (those grouped
  // into a section), so a stray legacy category never shows up.
  useEffect(() => {
    let active = true;
    const known = new Set(SECTION_GROUPS.flatMap((g) => g.tiles.map((tl) => tl.category)));
    fetchCategories()
      .then((all) => { if (active) setCategories(all.filter((c) => known.has(c.name))); })
      .catch(() => { /* tolerate */ });
    return () => { active = false; };
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadEssentials(), loadAddresses(), loadBestsellers(), loadCategoryImages(), refreshActiveOrders()]);
    setRefreshing(false);
  }, [loadEssentials, loadAddresses, loadBestsellers, loadCategoryImages, refreshActiveOrders]);

  const addressLine = activeAddress
    ? `${activeAddress.street}, ${activeAddress.locality}`
    : null;

  const openCategory = useCallback(
    (name: string) => navigation.navigate('CategoryProducts', { category: name }),
    [navigation],
  );

  // Entrance animations: header fades in, search slides up just after.
  const headerOpacity   = useRef(new Animated.Value(0)).current;
  const searchTranslate = useRef(new Animated.Value(20)).current;
  const searchOpacity   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(searchOpacity, { toValue: 1, duration: 300, delay: 100, useNativeDriver: true }),
      Animated.timing(searchTranslate, { toValue: 0, duration: 300, delay: 100, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      {/* ── Header — delivery ETA + tappable address + profile icon ───────── */}
      <Header
        entranceOpacity={headerOpacity}
        addressLine={addressLine}
        night={closed}
        onProfilePress={() => navigation.navigate('MainTabs', { screen: 'Profile' })}
        onLocationPress={() => setSheetOpen(true)}
      />

      {/* ── Search bar — overlaps the header's bottom edge. ───────────────── */}
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
            onRefresh={onRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
      >
        {closed && <ClosedBanner />}
        {activeOrders.length > 0 && (
          <ActiveOrdersStrip
            entries={activeOrders}
            onPressEntry={(entry) =>
              navigation.navigate(
                'OrderTracking',
                entry.groupId
                  ? { orderId: entry.orderId, groupId: entry.groupId }
                  : { orderId: entry.orderId },
              )
            }
            onPressViewAll={() => navigation.navigate('MainTabs', { screen: 'OrderHistory' })}
          />
        )}
        <DailyEssentialsShelf tiles={essentials} loading={essLoading} />
        <BestsellersSection clusters={bestsellers} onSelect={openCategory} />
        <CategorySections categories={categories} onSelect={openCategory} imagesByCategory={categoryImages} />
        <View style={{ height: Spacing.huge * 2 }} />
      </ScrollView>

      {/* Delivery-location bottom sheet (opens from the header address row) */}
      <LocationSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        userName={state.name}
        userPhone={state.phone}
      />

      {/* App-open "location off" prompt (#7) */}
      <LocationPermissionModal
        visible={permModal}
        onEnable={() => void handleEnableLocation()}
        onSelectManually={handleSelectManually}
      />
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    // Pull the SearchBar up into the orange header's bottom padding zone.
    searchOverlap: { marginTop: -20 },
    scrollContent: { paddingBottom: 0 },
  });
