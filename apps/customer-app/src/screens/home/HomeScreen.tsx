import React, { useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, ScrollView, Animated } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { useT } from '@chirawa/i18n';
import Header from './Header';
import SearchBar from './SearchBar';
import CategoryTabs from './CategoryTabs';
import FeaturedBanner from './FeaturedBanner';
import PopularProductsSection from './PopularProductsSection';
import BestsellersSection from './BestsellersSection';
import CategoryGrid, { GROCERY_KITCHEN, SNACKS_DRINKS } from './CategoryGrid';
import ShopsNearbySection from './ShopsNearbySection';
import ChirawaSpecialSection from './ChirawaSpecialSection';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'MainTabs'> };

// Home is now a fully category-first surface (Blinkit-style) — no shop list.
// Header + Search are fixed above the scroll; everything else scrolls.
export default function HomeScreen({ navigation }: Props) {
  const t = useT();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  // Entrance animations: header fades in, search + banner slide up just after.
  const headerOpacity   = useRef(new Animated.Value(0)).current;
  const searchTranslate = useRef(new Animated.Value(20)).current;
  const searchOpacity   = useRef(new Animated.Value(0)).current;
  const bannerTranslate = useRef(new Animated.Value(20)).current;
  const bannerOpacity   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(searchOpacity, { toValue: 1, duration: 300, delay: 100, useNativeDriver: true }),
      Animated.timing(searchTranslate, { toValue: 0, duration: 300, delay: 100, useNativeDriver: true }),
      Animated.timing(bannerOpacity, { toValue: 1, duration: 300, delay: 200, useNativeDriver: true }),
      Animated.timing(bannerTranslate, { toValue: 0, duration: 300, delay: 200, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      {/* ── 1. Header — Bringly + cycling tagline + profile icon ─────────── */}
      <Header
        entranceOpacity={headerOpacity}
        onProfilePress={() => navigation.navigate('MainTabs', { screen: 'Profile' })}
      />

      {/* ── 2. Search bar — outside the ScrollView; marginTop:-20 straddles
               the orange/cream boundary. */}
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
      >
        {/* ── 3. Category chips ──────────────────────────────────────────── */}
        <CategoryTabs />

        {/* ── 4. Featured banner — delivery promise ──────────────────────── */}
        <FeaturedBanner
          entranceOpacity={bannerOpacity}
          entranceTranslate={bannerTranslate}
        />

        {/* ── 5. Popular products — real add-to-cart cards (live API) ─────── */}
        <PopularProductsSection />

        {/* ── 6. Shop by category — real categories (live API) ───────────── */}
        <BestsellersSection />

        {/* ── 7. Grocery & Kitchen — 4-column icon tiles ─────────────────── */}
        <CategoryGrid title={t('home.groceryKitchen')} items={GROCERY_KITCHEN} />

        {/* ── 8. Snacks & Drinks — 4-column icon tiles ───────────────────── */}
        <CategoryGrid title={t('home.snacksDrinks')} items={SNACKS_DRINKS} />

        {/* ── 9. Shops near you — general (non-featured) shops (live API) ── */}
        <ShopsNearbySection />

        {/* ── 10. Chirawa's Special — featured local-shops carousel ──────── */}
        <ChirawaSpecialSection />

        <View style={{ height: Spacing.huge }} />
      </ScrollView>
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
