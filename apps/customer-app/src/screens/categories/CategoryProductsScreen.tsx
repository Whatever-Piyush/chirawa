import React, { useEffect, useLayoutEffect, useState } from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Text } from '../../components/ui';
import { Colors } from '../../theme';
import ProductCard from '../../components/product/ProductCard';
import { fetchProducts, toProductCard, type ApiProduct } from '../../services/catalog';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'CategoryProducts'>;
  route:      RouteProp<RootStackParamList, 'CategoryProducts'>;
};

// Product grid for a single category (across all shops). Reached from the
// Bestsellers cards and the Categories tab.
export default function CategoryProductsScreen({ navigation, route }: Props) {
  const { category } = route.params;
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [loading, setLoading]   = useState(true);

  useLayoutEffect(() => {
    navigation.setOptions({ title: category });
  }, [navigation, category]);

  useEffect(() => {
    let active = true;
    fetchProducts({ category, limit: 100 })
      .then((p) => { if (active) setProducts(p); })
      .catch(() => { /* tolerate */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [category]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  }
  if (products.length === 0) {
    return <View style={styles.center}><Text color={Colors.textSecondary}>No items here yet</Text></View>;
  }

  return (
    <FlatList
      data={products}
      keyExtractor={(p) => p.id}
      numColumns={2}
      columnWrapperStyle={styles.row}
      contentContainerStyle={styles.grid}
      renderItem={({ item }) => <ProductCard product={toProductCard(item)} />}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  grid:   { padding: 16, rowGap: 12, backgroundColor: Colors.background, flexGrow: 1 },
  row:    { gap: 12, justifyContent: 'space-between' },
});
