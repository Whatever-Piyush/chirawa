import React, { useMemo } from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from '../../components/ui';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import ProductCard, { type ProductCardData } from '../../components/product/ProductCard';

// "Daily Essentials" (TOP_SELLING_SKUS.md) — a flat horizontal rail of the
// everyday top-selling SKUs for a tier-3 town like Chirawa (milk, atta, bread,
// eggs, oil, dal, tea, soap, biscuits…), ordered by buy-frequency so a shopper
// grabs the basics without scrolling or searching. Tiles are real in-stock SKUs
// at the aggregated lowest price (shop hidden). Presentational: tiles come from
// HomeScreen's fetch. Layout matches the rest of the home (title 17 · HPAD 16).
interface Props {
  tiles:    ProductCardData[];
  loading?: boolean;
}

function DailyEssentialsShelf({ tiles, loading }: Props) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  if (!loading && tiles.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text weight="bold" color={Colors.textPrimary} style={styles.title}>Daily Essentials</Text>
      <Text weight="regular" color={Colors.textSecondary} style={styles.subtitle}>
        Milk, atta, bread & more — in minutes
      </Text>

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

// Memoised — only re-renders when tiles / loading change.
export default React.memo(DailyEssentialsShelf);

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    section:  { marginTop: 18 },
    title:    { fontSize: 17, lineHeight: 22, marginHorizontal: 16 },
    subtitle: { fontSize: 12, lineHeight: 16, marginHorizontal: 16, marginTop: 1, marginBottom: 12 },
    row:      { paddingHorizontal: 16, gap: 10 },
    loading:  { height: 200, justifyContent: 'center', alignItems: 'center' },
  });
