import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, Switch, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { Colors, Spacing, FontSize, Radius, Shadow } from '../../theme';
import { SellerApi } from '../../services/api.service';
import { useAuth } from '../../context/AuthContext';

interface Product {
  id: string; name: string; stockStatus: string;
  price: number; unit: string | null;
}
interface Category { id: string; name: string; products: Product[] }
interface ShopData  { id: string; name: string; categories: Category[] }

export default function StockScreen() {
  const { state }                   = useAuth();
  const [shop,    setShop]          = useState<ShopData | null>(null);
  const [loading, setLoading]       = useState(true);
  const [updating, setUpdating]     = useState<string | null>(null);

  const loadShop = useCallback(async () => {
    if (!state.token || !state.userId) return;
    try {
      // Get seller's shop via orders endpoint — shop comes from profile
      // For now get all orders to find shopId
      const orders = await SellerApi.getOrders(state.token) as Array<{ shopId: string }>;
      const shopId = orders[0]?.shopId;
      if (!shopId) { setLoading(false); return; }
      const data = await SellerApi.getShopProducts(shopId, state.token) as ShopData;
      setShop(data);
    } catch (e) {
      console.error('Load shop failed:', e);
    } finally {
      setLoading(false);
    }
  }, [state.token, state.userId]);

  useEffect(() => { void loadShop(); }, [loadShop]);

  async function toggleStock(productId: string, currentStatus: string) {
    if (!state.token) return;
    setUpdating(productId);
    const newStatus = currentStatus === 'available' ? 'out_of_stock' : 'available';
    try {
      await SellerApi.updateStock(productId, newStatus, state.token);
      await loadShop();
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Update nahi hua');
    } finally {
      setUpdating(null);
    }
  }

  const allProducts = shop?.categories.flatMap((c) => c.products) ?? [];

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.accent} size="large" /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Stock Management</Text>
        <Text style={styles.headerSub}>{allProducts.filter((p) => p.stockStatus === 'available').length}/{allProducts.length} available</Text>
      </View>

      {!shop
        ? <View style={styles.center}><Text style={styles.noShop}>Koi shop nahi mili</Text></View>
        : <FlatList
            data={allProducts}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.sm }}
            renderItem={({ item }) => (
              <View style={styles.productRow}>
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{item.name}</Text>
                  <Text style={styles.productPrice}>
                    ₹{Math.round(item.price / 100)}{item.unit ? ` / ${item.unit}` : ''}
                  </Text>
                </View>
                {updating === item.id
                  ? <ActivityIndicator color={Colors.accent} />
                  : <Switch
                      value={item.stockStatus === 'available'}
                      onValueChange={() => void toggleStock(item.id, item.stockStatus)}
                      trackColor={{ false: Colors.border, true: Colors.success }}
                      thumbColor={Colors.white}
                    />
                }
              </View>
            )}
          />
      }
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    paddingTop: 56, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md,
    backgroundColor: Colors.primary, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.white },
  headerSub:   { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.7)' },
  noShop:      { fontSize: FontSize.lg, color: Colors.textMuted },
  productRow: {
    backgroundColor: Colors.card, borderRadius: Radius.md,
    padding: Spacing.lg, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
    ...Shadow.card,
  },
  productInfo:  { flex: 1 },
  productName:  { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  productPrice: { fontSize: FontSize.sm, color: Colors.textMuted },
});
