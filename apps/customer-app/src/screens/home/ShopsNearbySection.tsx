import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Text, SectionContainer } from '../../components/ui';
import { Colors, Spacing, Radius } from '../../theme';
import { fetchShops, type ApiShop } from '../../services/catalog';
import type { RootStackParamList } from '../../navigation/AppNavigator';

// "Shops near you" — the GENERAL shops (isFeatured = false), kept distinct from
// the Chirawa Special carousel. Tapping a row opens that shop's detail page.
export default function ShopsNearbySection() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [shops, setShops]     = useState<ApiShop[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchShops()
      .then((all) => { if (active) setShops(all.filter((s) => !s.isFeatured)); })
      .catch(() => { /* tolerate */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (!loading && shops.length === 0) return null;

  return (
    <SectionContainer title="Shops near you">
      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={Colors.primary} /></View>
      ) : (
        <View style={styles.list}>
          {shops.map((shop) => (
            <TouchableOpacity
              key={shop.id}
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('ShopDetail', { shopId: shop.id, shopName: shop.name })}
            >
              <View style={styles.avatar}>
                <Ionicons name="storefront-outline" size={22} color={Colors.primary} />
              </View>
              <View style={styles.info}>
                <Text weight="semibold" color={Colors.textPrimary} numberOfLines={1} style={styles.name}>
                  {shop.name}
                </Text>
                <Text weight="regular" color={Colors.textSecondary} numberOfLines={1} style={styles.meta}>
                  {shop.isCurrentlyOpen ? 'Open now' : 'Closed'} · {shop.estimatedDeliveryMinutes} min
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </SectionContainer>
  );
}

const styles = StyleSheet.create({
  loading: { height: 80, justifyContent: 'center', alignItems: 'center' },
  list:    { paddingHorizontal: Spacing.lg, gap: 10 },
  row: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: Colors.surface,
    borderRadius:    Radius.md,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         12,
    gap:             12,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#FFF0E9',
    justifyContent: 'center', alignItems: 'center',
  },
  info: { flex: 1 },
  name: { fontSize: 14, lineHeight: 18 },
  meta: { fontSize: 12, lineHeight: 16, marginTop: 2 },
});
