import React, { useEffect, useState } from 'react';
import { ScrollView, View, StyleSheet, ActivityIndicator } from 'react-native';
import { SectionContainer } from '../../components/ui';
import { Colors } from '../../theme';
import ProductCard from '../../components/product/ProductCard';
import { fetchProducts, toProductCard, type ApiProduct } from '../../services/catalog';

// Real products on Home — a horizontal row of add-to-cart ProductCards pulled
// from /catalog/products. ProductCard wires its own cart state via useCart().
export default function PopularProductsSection() {
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    let active = true;
    fetchProducts({ limit: 12 })
      .then((p) => { if (active) setProducts(p); })
      .catch(() => { /* tolerate — section hides itself */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (!loading && products.length === 0) return null;

  return (
    <SectionContainer title="Popular near you">
      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={Colors.primary} /></View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {products.map((p) => (
            <View key={p.id} style={styles.cardWrap}>
              <ProductCard product={toProductCard(p)} />
            </View>
          ))}
        </ScrollView>
      )}
    </SectionContainer>
  );
}

const styles = StyleSheet.create({
  row:      { paddingHorizontal: 16, gap: 12 },
  cardWrap: { /* ProductCard sets its own fixed width */ },
  loading:  { height: 220, justifyContent: 'center', alignItems: 'center' },
});
