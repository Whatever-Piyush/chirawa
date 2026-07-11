import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Switch, ActivityIndicator } from 'react-native';
import { Colors, FontSize, Spacing, Radius, Shadow } from '../../theme';
import { useAuth } from '../../context/AuthContext';
import { SellerApi, type MyShop } from '../../services/api.service';

export default function ProfileScreen() {
  const { state, signOut } = useAuth();
  const [shop, setShop]       = useState<MyShop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [saving, setSaving]   = useState(false);

  const load = useCallback(async () => {
    if (!state.token) return;
    setError(false);
    try {
      setShop(await SellerApi.getMyShop(state.token));
    } catch {
      setError(true); // never silently blank — offer retry (Seller Sprint 0 P0-3)
    } finally {
      setLoading(false);
    }
  }, [state.token]);

  useEffect(() => { void load(); }, [load]);

  const retry = useCallback(() => { setLoading(true); void load(); }, [load]);

  // Store open/close toggle (Seller Sprint 0 P0-2). Optimistic flip with rollback
  // on failure, backed by Shop.isOpen — the same gate the order resolver honours.
  async function toggleOpen(next: boolean) {
    if (!state.token || !shop || saving) return;
    const prev = shop.isOpen;
    setShop({ ...shop, isOpen: next });
    setSaving(true);
    try {
      const updated = await SellerApi.setShopOpen(next, state.token);
      setShop(updated);
    } catch (e: unknown) {
      setShop({ ...shop, isOpen: prev }); // rollback
      Alert.alert('Nahi ho paya', e instanceof Error ? e.message : 'Store status update nahi hua. Dobara koshish karein.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.emoji}>🏪</Text>

        {/* Store open/close */}
        {loading
          ? <View style={styles.card}><ActivityIndicator color={Colors.accent} /></View>
          : error
            ? <View style={styles.card}>
                <Text style={styles.storeName}>Store status load nahi hua</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={retry}>
                  <Text style={styles.retryBtnText}>🔄 Retry</Text>
                </TouchableOpacity>
              </View>
            : shop && <View style={styles.card}>
                <View style={styles.storeRow}>
                  <View style={styles.storeInfo}>
                    <Text style={styles.storeName} numberOfLines={1}>{shop.name}</Text>
                    <Text style={[styles.storeStatus, { color: shop.isOpen ? Colors.success : Colors.textMuted }]}>
                      {shop.isOpen ? `🟢 Khula hai · ${shop.openTime}–${shop.closeTime}` : '⚫ Band hai'}
                    </Text>
                  </View>
                  {saving
                    ? <ActivityIndicator color={Colors.accent} />
                    : <Switch
                        value={shop.isOpen}
                        onValueChange={(v) => void toggleOpen(v)}
                        trackColor={{ false: Colors.border, true: Colors.success }}
                        thumbColor={Colors.white}
                      />
                  }
                </View>
                <Text style={styles.storeHint}>
                  {shop.isOpen ? 'Band karne par naye order nahi aayenge' : 'Khula karein taaki customer order kar sakein'}
                </Text>
              </View>
        }

        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={() => Alert.alert('Logout', 'Logout karna chahte hain?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Logout', style: 'destructive', onPress: () => void signOut() },
          ])}
        >
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: Colors.background },
  header:     { paddingTop: 56, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md, backgroundColor: Colors.primary },
  title:      { fontSize: FontSize.xl, fontWeight: '800', color: Colors.white },
  content:    { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.xl, padding: Spacing.lg },
  emoji:      { fontSize: 64 },
  card:       { backgroundColor: Colors.card, borderRadius: Radius.lg, padding: Spacing.lg, width: '100%', gap: Spacing.sm, alignItems: 'center', ...Shadow.card },
  storeRow:   { flexDirection: 'row', alignItems: 'center', width: '100%', gap: Spacing.md },
  storeInfo:  { flex: 1 },
  storeName:  { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  storeStatus:{ fontSize: FontSize.sm, fontWeight: '600', marginTop: 2 },
  storeHint:  { fontSize: FontSize.xs, color: Colors.textMuted, alignSelf: 'flex-start' },
  retryBtn:   { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm, marginTop: Spacing.sm },
  retryBtnText: { color: Colors.white, fontWeight: '800', fontSize: FontSize.md },
  logoutBtn:  { backgroundColor: Colors.error, borderRadius: Radius.md, paddingVertical: 14, paddingHorizontal: 48 },
  logoutText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '700' },
});
