import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Animated } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AddressResponse } from '@chirawa/types';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { useStoreClosed } from '../../hooks/useStoreClosed';
import { api } from '../../services/api.service';
import { fetchCategories, type ApiCategory } from '../../services/catalog';
import { useAuth } from '../../context/AuthContext';
import LocationSheet from '../../components/location/LocationSheet';
import Header from './Header';
import SearchBar from './SearchBar';
import ProductCarouselSection from './ProductCarouselSection';
import CategorySections from './CategorySections';
import ClosedBanner from './ClosedBanner';
import { SECTION_GROUPS, CAROUSEL_SECTIONS } from './categoryMeta';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'MainTabs'> };

// Category-first home: a fixed header + search, then two horizontally-scrollable
// category strips (chips + icons) and themed category sections below.
export default function HomeScreen({ navigation }: Props) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const { state } = useAuth();

  // Delivery address shown in the header + edited via the location sheet.
  const [addresses, setAddresses] = useState<AddressResponse[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [categories, setCategories] = useState<ApiCategory[]>([]);

  const loadAddresses = useCallback(async () => {
    try {
      const data = await api.getAddresses();
      data.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      setAddresses(data);
    } catch {
      /* tolerate — header falls back to "Set your delivery location" */
    }
  }, []);

  // Outside delivery hours the header + banner go night-themed (shared hook
  // handles the open↔close transition + auto-restore at opening time).
  const closed = useStoreClosed();

  useEffect(() => { void loadAddresses(); }, [loadAddresses]);
  useEffect(
    () => navigation.addListener('focus', () => { void loadAddresses(); }),
    [navigation, loadAddresses],
  );

  // Load categories once. Keep only the known/curated categories (those grouped
  // into a section), so a stray legacy category never shows up.
  useEffect(() => {
    let active = true;
    const known = new Set(SECTION_GROUPS.flatMap((g) => g.tiles.map((tl) => tl.category)));
    fetchCategories()
      .then((all) => { if (active) setCategories(all.filter((c) => known.has(c.name))); })
      .catch(() => { /* tolerate */ })
      .finally(() => { /* no-op */ });
    return () => { active = false; };
  }, []);

  const activeAddress = addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
  const addressLine = activeAddress
    ? `${activeAddress.street}, ${activeAddress.locality}`
    : null;

  const openCategory = useCallback(
    (name: string) => navigation.navigate('CategoryProducts', { category: name }),
    [navigation],
  );

  // Entrance animations: header fades in, search + banner slide up just after.
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

      {/* ── Closed banner — outside delivery hours (browsing still allowed) ── */}
      {closed && <ClosedBanner />}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Two product carousels, each with a category tab bar ────────── */}
        {CAROUSEL_SECTIONS.map((s) => (
          <ProductCarouselSection
            key={s.title}
            title={s.title}
            subtitle={s.subtitle}
            tabs={s.tabs}
            onSeeAll={openCategory}
          />
        ))}

        {/* ── Themed category sections — 4 equal tiles per row ───────────── */}
        <CategorySections categories={categories} onSelect={openCategory} />

        <View style={{ height: Spacing.huge }} />
      </ScrollView>

      {/* Delivery-location bottom sheet (opens from the header address row) */}
      <LocationSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        addresses={addresses}
        userName={state.name}
        userPhone={state.phone}
        onChanged={loadAddresses}
      />
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { paddingBottom: Spacing.xxxl },
  // Pull the SearchBar up into the orange header's bottom padding zone.
  searchOverlap: { marginTop: -20 },
});
