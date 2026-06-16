import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Animated } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AddressResponse } from '@chirawa/types';
import { Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { fetchCategories, fetchCategoryImages, type ApiCategory } from '../../services/catalog';
import { api } from '../../services/api.service';
import { useAuth } from '../../context/AuthContext';
import Header from '../home/Header';
import SearchBar from '../home/SearchBar';
import ClosedBanner from '../home/ClosedBanner';
import CategorySections from '../home/CategorySections';
import BrandedLoader from '../../components/BrandedLoader';
import { useStoreClosed } from '../../hooks/useStoreClosed';
import LocationSheet from '../../components/location/LocationSheet';
import type { RootStackParamList } from '../../navigation/AppNavigator';

// Categories deliberately hidden on this surface (by request).
const HIDDEN = ['Mangoes & Melons', 'Health & Pharma', 'Sexual Wellness'];

// ─── Categories tab — Blinkit-style themed image grids (same as Home) ──────────
// Home-style header + sticky search, then the curated category sections rendered
// as 4-col real-image tiles (reuses the Home CategorySections), minus the hidden
// categories above.
export default function CategoriesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const { state } = useAuth();
  const closed = useStoreClosed();

  const [categories, setCategories]       = useState<ApiCategory[]>([]);
  const [categoryImages, setCategoryImages] = useState<Record<string, string[]>>({});
  const [loading, setLoading]             = useState(true);
  const [addresses, setAddresses]         = useState<AddressResponse[]>([]);
  const [sheetOpen, setSheetOpen]         = useState(false);

  // Header + search fade in together.
  const headerOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let active = true;
    // One pass: category list (drives which tiles are live) + per-category images.
    Promise.all([fetchCategories(), fetchCategoryImages()])
      .then(([c, imgs]) => { if (active) { setCategories(c); setCategoryImages(imgs); } })
      .catch(() => { /* tolerate — tiles fall back to emoji */ })
      .finally(() => { if (active) setLoading(false); });
    Animated.timing(headerOpacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    return () => { active = false; };
  }, [headerOpacity]);

  const loadAddresses = useCallback(async () => {
    try {
      const data = await api.getAddresses();
      data.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      setAddresses(data);
    } catch {
      /* tolerate */
    }
  }, []);

  useEffect(() => { void loadAddresses(); }, [loadAddresses]);
  useEffect(
    () => navigation.addListener('focus', () => { void loadAddresses(); }),
    [navigation, loadAddresses],
  );

  const activeAddress = addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
  const addressLine = activeAddress
    ? `${activeAddress.street}, ${activeAddress.locality}`
    : null;

  const openCategory = useCallback(
    (name: string) => navigation.navigate('CategoryProducts', { category: name }),
    [navigation],
  );

  return (
    <View style={styles.container}>
      {/* Same delivery-ETA + address header as Home */}
      <Header
        entranceOpacity={headerOpacity}
        addressLine={addressLine}
        night={closed}
        onProfilePress={() => navigation.navigate('MainTabs', { screen: 'Profile' })}
        onLocationPress={() => setSheetOpen(true)}
      />

      {/* Sticky search bar — straddles the orange/cream boundary */}
      <View style={styles.searchOverlap}>
        <SearchBar
          entranceOpacity={headerOpacity}
          onPress={() => navigation.navigate('Search')}
        />
      </View>

      {loading ? (
        <BrandedLoader />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {closed && <ClosedBanner />}
          <CategorySections
            categories={categories}
            onSelect={openCategory}
            imagesByCategory={categoryImages}
            exclude={HIDDEN}
          />
          <View style={{ height: Spacing.huge }} />
        </ScrollView>
      )}

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
    // Pull the SearchBar up into the orange header's bottom padding (matches Home).
    searchOverlap: { marginTop: -20 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    scroll: { paddingBottom: Spacing.xxxl },
  });
