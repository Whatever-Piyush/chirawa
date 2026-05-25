import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Colors, Spacing, FontSize } from '../../theme';
import { RiderApi } from '../../services/api.service';
import { useAuth } from '../../context/AuthContext';
interface Order { id: string; totalAmount: number; status: string; deliveredAt: string | null }
export default function EarningsScreen() {
  const { state } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!state.token) return;
    void RiderApi.getMyOrders(state.token).then((data) => setOrders(data as Order[])).finally(() => setLoading(false));
  }, [state.token]);
  const delivered = orders.filter((o) => o.status === 'delivered');
  const today = delivered.filter((o) => o.deliveredAt && new Date(o.deliveredAt).toDateString() === new Date().toDateString());
  const todayEarnings = today.reduce((s, o) => s + 0, 0); // Salary-based, not per-order
  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} size="large" /></View>;
  return (
    <View style={styles.container}>
      <View style={styles.header}><Text style={styles.title}>Kamai</Text></View>
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Aaj Ki Deliveries</Text>
        <Text style={styles.cardValue}>{today.length}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Is Mahine Total</Text>
        <Text style={styles.cardValue}>{delivered.length}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Monthly Salary</Text>
        <Text style={styles.cardValue}>₹7,500</Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header:    { paddingTop: 56, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md, backgroundColor: Colors.primary },
  title:     { fontSize: FontSize.xl, fontWeight: '800', color: Colors.white },
  card:      { margin: Spacing.lg, backgroundColor: Colors.white, borderRadius: 12, padding: Spacing.xl, alignItems: 'center', gap: Spacing.sm },
  cardLabel: { fontSize: FontSize.md, color: Colors.textMuted },
  cardValue: { fontSize: FontSize.xxxl, fontWeight: '900', color: Colors.primary },
});
