import React, { useMemo } from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from '../../components/ui';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import ProductCard, { type ProductCardData } from '../../components/product/ProductCard';

// "For You" — a flat horizontal swiper of aggregated feed tiles (Catalog Engine
// Phase 4), NO category pills. One canonical tile per product at the lowest
// in-stock price, shop identity hidden; the concrete shop is chosen by the
// Phase-5 resolver at checkout. Presentational: tiles + loading come from
// HomeScreen's single feed fetch, so there's no extra network call here.
interface Props {
  tiles:    ProductCardData[];
  loading?: boolean;
}

function ForYouFeedShelf({ tiles, loading }: Props) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  // Nothing to show once loaded + empty — the section collapses cleanly.
  if (!loading && tiles.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text weight="bold" color={Colors.textPrimary} style={styles.title}>For You</Text>

      {loading && tiles.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          horizontal
          data={tiles}
          keyExtractor={(t) => t.productId}
          renderItem={({ item }) => <ProductCard product={item} size="dense" />}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
          initialNumToRender={6}
          windowSize={5}
          removeClippedSubviews
        />
      )}
    </View>
  );
}

// Memoised — only re-renders when the feed slice / loading change.
export default React.memo(ForYouFeedShelf);

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    // Matches CategorySections / Bestsellers (title 17 · marginTop 18 · HPAD 16).
    section: { marginTop: 18 },
    title:   { fontSize: 17, lineHeight: 22, marginHorizontal: 16, marginBottom: 12 },
    row:     { paddingHorizontal: 16, gap: 10 },
    loading: { height: 200, justifyContent: 'center', alignItems: 'center' },
  });
