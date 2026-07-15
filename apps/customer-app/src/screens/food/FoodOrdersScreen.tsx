import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { FoodOrderSummary } from '@chirawa/types';
import { useT } from '@chirawa/i18n';
import { Text, Shimmer } from '../../components/ui';
import { Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { api } from '../../services/api.service';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { FOOD_ACCENT, FOOD_ACCENT_SOFT } from './foodTheme';

// ─── Food order history (Food.md §8.5) ────────────────────────────────────────
// Food orders live in their own pipeline, so they get their own lightweight
// history list (the marketplace Order Again screen is untouched).

type Navigation = NativeStackNavigationProp<RootStackParamList, 'FoodOrders'>;

const STATUS_KEY: Record<string, string> = {
  pending_payment: 'food.statusPendingPayment',
  paid: 'food.statusPaid',
  confirmed: 'food.statusConfirmed',
  preparing: 'food.statusPreparing',
  ready_for_pickup: 'food.statusReady',
  picked_up: 'food.statusPickedUp',
  out_for_delivery: 'food.statusOutForDelivery',
  delivered: 'food.statusDelivered',
  cancelled: 'food.statusCancelled',
};

export default function FoodOrdersScreen({ navigation }: { navigation: Navigation }) {
  const t = useT();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  const [orders, setOrders]   = useState<FoodOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setOrders(await api.getFoodOrders());
    } catch {
      /* keep last list */
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const renderOrder = useCallback(({ item }: { item: FoodOrderSummary }) => {
    const live = !['delivered', 'cancelled'].includes(item.status);
    const itemsLine = item.items.map((i) => `${i.quantity}× ${i.name}`).join(', ');
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('FoodOrderTracking', { foodOrderId: item.id })}
      >
        <View style={styles.cardTop}>
          <View style={styles.cardIcon}>
            <Ionicons name="restaurant" size={16} color={FOOD_ACCENT} />
          </View>
          <View style={{ flex: 1 }}>
            <Text weight="bold" color={Colors.textPrimary} numberOfLines={1} style={styles.cardName}>
              {item.restaurant.name}
            </Text>
            <Text weight="regular" color={Colors.textSecondary} numberOfLines={1} style={styles.cardItems}>
              {itemsLine}
            </Text>
          </View>
          <Text weight="bold" color={Colors.textPrimary} style={styles.cardAmt}>
            ₹{Math.round(item.totalPaise / 100)}
          </Text>
        </View>
        <View style={styles.cardBottom}>
          <View style={[styles.statusPill, live && styles.statusPillLive]}>
            <Text
              weight="semibold"
              color={live ? FOOD_ACCENT : Colors.textSecondary}
              style={styles.statusText}
            >
              {t(STATUS_KEY[item.status] ?? 'food.statusPaid')}
            </Text>
          </View>
          <Text weight="regular" color={Colors.textTertiary} style={styles.cardDate}>
            {new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }, [navigation, styles, Colors, t]);

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.skeletons}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Shimmer key={i} width="100%" height={88} borderRadius={Radius.xl} />
          ))}
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="fast-food-outline" size={30} color={FOOD_ACCENT} />
          </View>
          <Text weight="bold" color={Colors.textPrimary} style={styles.emptyTitle}>
            {t('food.noOrders')}
          </Text>
          <Text weight="regular" color={Colors.textSecondary} align="center" style={styles.emptyCopy}>
            {t('food.noOrdersDesc')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          renderItem={renderOrder}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={FOOD_ACCENT} />
          }
        />
      )}
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    skeletons: { padding: Spacing.md, gap: Spacing.md },
    list: { padding: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.huge },
    card: {
      backgroundColor: Colors.surface, borderRadius: Radius.xl,
      padding: Spacing.md, marginBottom: Spacing.xs,
      ...Shadow.xs,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    cardIcon: {
      width: 34, height: 34, borderRadius: 14,
      backgroundColor: FOOD_ACCENT_SOFT,
      alignItems: 'center', justifyContent: 'center',
    },
    cardName: { fontSize: 14, lineHeight: 18 },
    cardItems: { fontSize: 11, lineHeight: 15, marginTop: 1 },
    cardAmt: { fontSize: 14 },
    cardBottom: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginTop: Spacing.sm,
    },
    statusPill: {
      paddingHorizontal: 10, paddingVertical: 4,
      borderRadius: Radius.full, backgroundColor: Colors.surfaceAlt,
    },
    statusPillLive: { backgroundColor: FOOD_ACCENT_SOFT },
    statusText: { fontSize: 10, lineHeight: 13 },
    cardDate: { fontSize: 10, lineHeight: 13 },
    empty: {
      flex: 1, alignItems: 'center', justifyContent: 'center',
      paddingHorizontal: Spacing.xl, gap: Spacing.sm,
    },
    emptyIcon: {
      width: 64, height: 64, borderRadius: 26,
      backgroundColor: FOOD_ACCENT_SOFT,
      alignItems: 'center', justifyContent: 'center',
      marginBottom: Spacing.xs,
    },
    emptyTitle: { fontSize: 15, lineHeight: 20 },
    emptyCopy: { fontSize: 12, lineHeight: 17, maxWidth: 240 },
  });
