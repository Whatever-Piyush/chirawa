import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Colors, FontSize, Spacing, Radius, Shadow } from '../../theme';
import { SellerApi, type SalesSummary, type SettlementsResponse } from '../../services/api.service';
import { useAuth } from '../../context/AuthContext';

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;

function StatTile({ label, orders, valuePaise }: { label: string; orders: number; valuePaise: number }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{rupees(valuePaise)}</Text>
      <Text style={styles.tileOrders}>{orders} order{orders === 1 ? '' : 's'}</Text>
    </View>
  );
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', processing: 'Processing', paid: 'Paid ✓', failed: 'Failed',
};

export default function SettlementScreen() {
  const { state } = useAuth();
  const [sales,    setSales]    = useState<SalesSummary | null>(null);
  const [settle,   setSettle]   = useState<SettlementsResponse | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,    setError]    = useState(false);

  const load = useCallback(async () => {
    if (!state.token) return;
    setError(false);
    try {
      const [s, st] = await Promise.all([
        SellerApi.getSalesSummary(state.token),
        SellerApi.getSettlements(state.token),
      ]);
      setSales(s);
      setSettle(st);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [state.token]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}><Text style={styles.title}>Settlement</Text></View>
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settlement</Text>
        {sales?.shopName ? <Text style={styles.subtitle}>{sales.shopName}</Text> : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={Colors.primary} />
        }
      >
        {error && <Text style={styles.errorText}>Data load nahi hua. Neeche kheech kar refresh karein.</Text>}

        {/* ── Sales summary (8.4) ─────────────────────────────────────────── */}
        {sales && (
          <>
            <Text style={styles.sectionTitle}>Aapki bikri</Text>
            <View style={styles.tileRow}>
              <StatTile label="Aaj"      orders={sales.today.orders} valuePaise={sales.today.valuePaise} />
              <StatTile label="Is hafte" orders={sales.week.orders}  valuePaise={sales.week.valuePaise} />
              <StatTile label="Is mahine" orders={sales.month.orders} valuePaise={sales.month.valuePaise} />
            </View>
            <View style={styles.bestCard}>
              <Text style={styles.bestLabel}>⭐ Is hafte sabse zyada bika</Text>
              <Text style={styles.bestValue}>
                {sales.bestSeller ? `${sales.bestSeller.productName} (${sales.bestSeller.quantity})` : '— abhi koi nahi —'}
              </Text>
            </View>
          </>
        )}

        {/* ── Settlement (8.5) ────────────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Payment</Text>
        {settle && (
          <View style={styles.currentCard}>
            <Text style={styles.currentLabel}>Abhi tak (unsettled)</Text>
            <Text style={styles.currentValue}>{rupees(settle.current.netPayablePaise)}</Text>
            <Text style={styles.currentSub}>{settle.current.orders} delivered order{settle.current.orders === 1 ? '' : 's'} · 0% commission</Text>
          </View>
        )}

        {settle && settle.settlements.length === 0 ? (
          <Text style={styles.emptyText}>Abhi tak koi settlement nahi hua. Pehli payment delivery ke baad aayegi.</Text>
        ) : (
          settle?.settlements.map((s) => (
            <View key={s.id} style={styles.settleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.settleDate}>{new Date(s.periodDate).toLocaleDateString('en-IN')}</Text>
                <Text style={styles.settleMeta}>{s.totalOrders} orders</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.settleAmount}>{rupees(s.netPayablePaise)}</Text>
                <Text style={[styles.settleStatus, s.status === 'paid' && { color: Colors.success }]}>
                  {STATUS_LABEL[s.status] ?? s.status}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingTop: 56, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md, backgroundColor: Colors.primary },
  title:   { fontSize: FontSize.xl, fontWeight: '800', color: Colors.white },
  subtitle: { fontSize: FontSize.sm, color: Colors.white, opacity: 0.9, marginTop: 2 },
  center:  { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll:  { padding: Spacing.lg, gap: Spacing.md },
  errorText: { color: Colors.error, fontSize: FontSize.sm, textAlign: 'center' },

  sectionTitle: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text, marginTop: Spacing.sm },
  tileRow: { flexDirection: 'row', gap: Spacing.sm },
  tile: { flex: 1, backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, gap: 2, ...Shadow.card },
  tileLabel:  { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '700' },
  tileValue:  { fontSize: FontSize.lg, fontWeight: '900', color: Colors.text },
  tileOrders: { fontSize: FontSize.xs, color: Colors.textLight },

  bestCard: { backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, ...Shadow.card },
  bestLabel: { fontSize: FontSize.sm, color: Colors.textLight, fontWeight: '700' },
  bestValue: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text, marginTop: 2 },

  currentCard: { backgroundColor: Colors.success, borderRadius: Radius.lg, padding: Spacing.lg, ...Shadow.card },
  currentLabel: { fontSize: FontSize.sm, color: Colors.white, opacity: 0.9, fontWeight: '700' },
  currentValue: { fontSize: FontSize.xxxl, fontWeight: '900', color: Colors.white, marginTop: 2 },
  currentSub:   { fontSize: FontSize.xs, color: Colors.white, opacity: 0.9, marginTop: 2 },

  emptyText: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center', paddingVertical: Spacing.lg },
  settleRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, ...Shadow.card },
  settleDate:   { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  settleMeta:   { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 1 },
  settleAmount: { fontSize: FontSize.md, fontWeight: '900', color: Colors.text },
  settleStatus: { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '700', marginTop: 1 },
});
