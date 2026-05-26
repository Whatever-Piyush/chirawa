import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, TextInput, ActivityIndicator,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Colors, Spacing, FontSize, Radius, Shadow } from '../../theme';
import { api } from '../../services/api.service';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'MainTabs'> };

interface Shop {
  id: string; name: string; description: string | null;
  estimatedDeliveryMinutes: number; isCurrentlyOpen: boolean;
  address: string; logoUrl: string | null;
}

export default function HomeScreen({ navigation }: Props) {
  const [shops,     setShops]     = useState<Shop[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,    setSearch]    = useState('');

  const loadShops = useCallback(async () => {
    try {
      const data = await api.getShops() as Shop[];
      setShops(data);
    } catch (err) {
      console.error('Failed to load shops:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadShops(); }, [loadShops]);

  const filtered = shops.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()),
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerGreeting}>नमस्ते! 👋</Text>
          <Text style={styles.headerTitle}>Bringly</Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('Cart')}
          style={styles.cartBtn}
        >
          <Text style={styles.cartEmoji}>🛒</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchBox}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Dukaan ya saman dhundho..."
          placeholderTextColor={Colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Shop list */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); void loadShops(); }}
            colors={[Colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🏪</Text>
            <Text style={styles.emptyText}>Koi dukaan nahi mili</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.shopCard}
            onPress={() =>
              navigation.navigate('ShopDetail', { shopId: item.id, shopName: item.name })
            }
            activeOpacity={0.85}
          >
            <View style={styles.shopCardLeft}>
              <View style={styles.shopEmoji}>
                <Text style={{ fontSize: 32 }}>🏪</Text>
              </View>
            </View>
            <View style={styles.shopCardRight}>
              <View style={styles.shopNameRow}>
                <Text style={styles.shopName}>{item.name}</Text>
                <View style={[
                  styles.openBadge,
                  { backgroundColor: item.isCurrentlyOpen ? Colors.success : Colors.error },
                ]}>
                  <Text style={styles.openBadgeText}>
                    {item.isCurrentlyOpen ? 'खुला' : 'बंद'}
                  </Text>
                </View>
              </View>
              {item.description
                ? <Text style={styles.shopDesc} numberOfLines={1}>{item.description}</Text>
                : null
              }
              <View style={styles.shopMeta}>
                <Text style={styles.shopMetaText}>
                  ⏱ {item.estimatedDeliveryMinutes} मिनट
                </Text>
                <Text style={styles.shopMetaText}>📍 {item.address}</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingTop: 56, paddingBottom: Spacing.lg,
    backgroundColor: Colors.primary,
  },
  headerGreeting: { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.8)' },
  headerTitle:    { fontSize: FontSize.xl, fontWeight: '800', color: Colors.white },
  cartBtn: {
    width: 44, height: 44, backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: Radius.full, justifyContent: 'center', alignItems: 'center',
  },
  cartEmoji: { fontSize: 22 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.white, margin: Spacing.lg,
    borderRadius: Radius.md, paddingHorizontal: Spacing.md,
    ...Shadow.card,
  },
  searchIcon:  { fontSize: 16, marginRight: Spacing.sm },
  searchInput: { flex: 1, height: 44, fontSize: FontSize.md, color: Colors.text },
  list:        { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  shopCard: {
    backgroundColor: Colors.card, borderRadius: Radius.lg,
    padding: Spacing.lg, flexDirection: 'row', gap: Spacing.md,
    ...Shadow.card,
  },
  shopCardLeft:  { justifyContent: 'center' },
  shopEmoji: {
    width: 64, height: 64, backgroundColor: Colors.background,
    borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center',
  },
  shopCardRight: { flex: 1, gap: Spacing.xs },
  shopNameRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  shopName:      { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, flex: 1 },
  openBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full },
  openBadgeText: { fontSize: FontSize.xs, color: Colors.white, fontWeight: '700' },
  shopDesc:  { fontSize: FontSize.sm, color: Colors.textLight },
  shopMeta:  { flexDirection: 'row', gap: Spacing.md, marginTop: 2 },
  shopMetaText: { fontSize: FontSize.xs, color: Colors.textMuted },
  empty:     { alignItems: 'center', marginTop: 80, gap: Spacing.md },
  emptyEmoji: { fontSize: 48 },
  emptyText:  { fontSize: FontSize.lg, color: Colors.textMuted },
});
