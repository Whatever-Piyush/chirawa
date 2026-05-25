import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Colors, Spacing, FontSize, Radius, Shadow } from '../../theme';
import { api } from '../../services/api.service';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ShopDetail'>;
  route:      RouteProp<RootStackParamList, 'ShopDetail'>;
};

interface Product {
  id: string; name: string; price: number;
  stockStatus: string; imageUrl: string | null;
  description: string | null; unit: string | null;
}

interface Category { id: string; name: string; products: Product[] }
interface ShopDetail { id: string; name: string; isCurrentlyOpen: boolean; openTime: string; closeTime: string; categories: Category[] }

export default function ShopDetailScreen({ navigation, route }: Props) {
  const { shopId, shopName } = route.params;
  const [shop,    setShop]   = useState<ShopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [cart,    setCart]   = useState<Record<string, number>>({});

  useEffect(() => {
    navigation.setOptions({ headerTitle: shopName });
    void loadShop();
  }, [shopId]);

  async function loadShop() {
    try {
      const data = await api.getShop(shopId) as ShopDetail;
      setShop(data);
    } catch {
      Alert.alert('Error', 'Dukaan load nahi hui');
    } finally {
      setLoading(false);
    }
  }

  async function addToCart(productId: string, quantity: number) {
    try {
      await api.addToCart({ productId, quantity });
      setCart((prev) => ({ ...prev, [productId]: (prev[productId] ?? 0) + quantity }));
      Alert.alert('✅', 'Cart mein add ho gaya!', [
        { text: 'Continue', style: 'cancel' },
        { text: 'Cart Dekho', onPress: () => navigation.navigate('Cart') },
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Cart mein add nahi hua';
      Alert.alert('Error', msg);
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={Colors.primary} size="large" /></View>;
  }

  if (!shop) return null;

  const allProducts = shop.categories.flatMap((c) => c.products);

  return (
    <View style={styles.container}>
      {/* Shop info banner */}
      <View style={styles.shopBanner}>
        <Text style={styles.shopName}>{shop.name}</Text>
        <Text style={styles.shopHours}>⏰ {shop.openTime} – {shop.closeTime}</Text>
        <View style={[
          styles.statusBadge,
          { backgroundColor: shop.isCurrentlyOpen ? Colors.success : Colors.error },
        ]}>
          <Text style={styles.statusText}>
            {shop.isCurrentlyOpen ? '🟢 अभी खुला है' : '🔴 बंद है'}
          </Text>
        </View>
      </View>

      <FlatList
        data={allProducts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={[
            styles.productCard,
            item.stockStatus === 'out_of_stock' && styles.productCardDisabled,
          ]}>
            <View style={styles.productEmoji}>
              <Text style={{ fontSize: 36 }}>🛒</Text>
            </View>
            <View style={styles.productInfo}>
              <Text style={styles.productName}>{item.name}</Text>
              {item.unit ? <Text style={styles.productUnit}>{item.unit}</Text> : null}
              {item.description
                ? <Text style={styles.productDesc} numberOfLines={2}>{item.description}</Text>
                : null
              }
              <View style={styles.productBottom}>
                <Text style={styles.productPrice}>₹{Math.round(item.price / 100)}</Text>
                {item.stockStatus === 'out_of_stock'
                  ? <View style={styles.outOfStockBadge}>
                      <Text style={styles.outOfStockText}>स्टॉक नहीं</Text>
                    </View>
                  : <TouchableOpacity
                      style={styles.addBtn}
                      onPress={() => void addToCart(item.id, 1)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.addBtnText}>+ Add</Text>
                    </TouchableOpacity>
                }
              </View>
            </View>
          </View>
        )}
      />

      {/* Sticky cart button */}
      <TouchableOpacity
        style={styles.cartBar}
        onPress={() => navigation.navigate('Cart')}
        activeOpacity={0.9}
      >
        <Text style={styles.cartBarText}>🛒 Cart Dekho</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  shopBanner: {
    backgroundColor: Colors.primary, padding: Spacing.lg,
    gap: Spacing.xs,
  },
  shopName:    { fontSize: FontSize.xl, fontWeight: '800', color: Colors.white },
  shopHours:   { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.8)' },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  statusText:  { fontSize: FontSize.sm, color: Colors.white, fontWeight: '600' },
  list:        { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 100 },
  productCard: {
    backgroundColor: Colors.card, borderRadius: Radius.lg,
    padding: Spacing.lg, flexDirection: 'row', gap: Spacing.md,
    ...Shadow.card,
  },
  productCardDisabled: { opacity: 0.6 },
  productEmoji: {
    width: 72, height: 72, backgroundColor: Colors.background,
    borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center',
  },
  productInfo:   { flex: 1, gap: 4 },
  productName:   { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  productUnit:   { fontSize: FontSize.xs, color: Colors.textMuted },
  productDesc:   { fontSize: FontSize.sm, color: Colors.textLight },
  productBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  productPrice:  { fontSize: FontSize.lg, fontWeight: '800', color: Colors.primary },
  addBtn: {
    backgroundColor: Colors.primary, paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm, borderRadius: Radius.md,
  },
  addBtnText:      { color: Colors.white, fontWeight: '700', fontSize: FontSize.md },
  outOfStockBadge: { backgroundColor: Colors.border, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.md },
  outOfStockText:  { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '600' },
  cartBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.primary, padding: Spacing.lg,
    alignItems: 'center',
  },
  cartBarText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '800' },
});
