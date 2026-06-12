import React, { useEffect, useMemo, useState } from 'react';
import {
  View, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/ui';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import ProductCard from '../../components/product/ProductCard';
import { fetchProducts, toProductCard, type ApiProduct } from '../../services/catalog';
import type { CarouselTab } from './categoryMeta';

interface Props {
  title:     string;
  subtitle?: string;
  tabs:      CarouselTab[];           // each shows `label`, filters by `category`
  onSeeAll:  (category: string) => void;
}

const ALL = 'All';

// A home product carousel: a title, a horizontally-scrollable category tab bar,
// and a horizontal row of product cards for the active tab. Products per tab are
// fetched lazily and cached so switching tabs is instant after the first load.
export default function ProductCarouselSection({ title, subtitle, tabs, onSeeAll }: Props) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  // `active` tracks the selected category (not the label).
  const [active, setActive] = useState(tabs[0]?.category ?? ALL);
  const [cache, setCache]   = useState<Record<string, ApiProduct[]>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (cache[active]) return;
    let alive = true;
    setLoading(true);
    fetchProducts({ ...(active === ALL ? {} : { category: active }), limit: 12 })
      .then((p) => { if (alive) setCache((c) => ({ ...c, [active]: p })); })
      .catch(() => { if (alive) setCache((c) => ({ ...c, [active]: [] })); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [active, cache]);

  const products = cache[active] ?? [];

  return (
    <View style={styles.section}>
      <Text weight="bold" color={Colors.textPrimary} style={styles.title}>{title}</Text>
      {subtitle ? (
        <Text weight="regular" color={Colors.textSecondary} style={styles.subtitle}>{subtitle}</Text>
      ) : null}

      {/* Category tab bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabBar}
      >
        {tabs.map((tab) => {
          const on = tab.category === active;
          return (
            <TouchableOpacity key={tab.category} onPress={() => setActive(tab.category)} activeOpacity={0.8} style={styles.tab}>
              <Text
                weight={on ? 'bold' : 'medium'}
                color={on ? Colors.primary : Colors.textSecondary}
                style={styles.tabText}
              >
                {tab.label}
              </Text>
              <View style={[styles.underline, on && { backgroundColor: Colors.primary }]} />
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Products */}
      {loading && products.length === 0 ? (
        <View style={styles.loading}><ActivityIndicator color={Colors.primary} /></View>
      ) : products.length === 0 ? null : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {products.map((p) => (
            <ProductCard key={p.id} product={toProductCard(p)} size="compact" />
          ))}
        </ScrollView>
      )}

      {/* See all */}
      {products.length > 0 && (
        <TouchableOpacity
          style={styles.seeAll}
          activeOpacity={0.8}
          onPress={() => onSeeAll(active === ALL ? (tabs[1]?.category ?? tabs[0]?.category ?? active) : active)}
        >
          <Text weight="semibold" color={Colors.textPrimary} style={styles.seeAllText}>See All</Text>
          <Ionicons name="chevron-forward" size={15} color={Colors.textPrimary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    section:  { marginTop: 14 },
    title:    { fontSize: 18, lineHeight: 23, marginHorizontal: 16, marginBottom: 8 },
    subtitle: { fontSize: 13, lineHeight: 17, marginHorizontal: 16, marginTop: -6, marginBottom: 8 },
    tabBar:   { paddingHorizontal: 16, gap: 18, marginBottom: 10 },
    tab:      { alignItems: 'center' },
    tabText:  { fontSize: 14, lineHeight: 18, paddingBottom: 6 },
    underline:{ height: 2, width: '100%', borderRadius: 1, backgroundColor: 'transparent' },
    loading:  { height: 220, justifyContent: 'center', alignItems: 'center' },
    row:      { paddingHorizontal: 16, gap: 10 },
    seeAll: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
      marginHorizontal: 16, marginTop: 12,
      borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
      paddingVertical: 11, backgroundColor: Colors.surface,
    },
    seeAllText: { fontSize: 14, lineHeight: 18 },
  });
