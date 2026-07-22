import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Colors, Spacing, FontSize, Radius, Shadow } from '../../theme';
import { SellerApi, type MorningCardItem } from '../../services/api.service';
import { useAuth } from '../../context/AuthContext';

// ─── Morning verification card (Inventory Engine S5) ──────────────────────────
// The ≤8 items the system most doubts today, ranked by expected cost of being
// wrong. One thumb per row: है / कम है / नहीं है. Answering removes the row —
// the whole card is designed to take under a minute.

export default function MorningCardScreen() {
  const { state }  = useAuth();
  const navigation = useNavigation();
  const [items, setItems]     = useState<MorningCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!state.token) return;
    try {
      const data = await SellerApi.getMorningCard(state.token);
      setItems(data.items);
    } catch (e) {
      console.error('Morning card load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [state.token]);

  useEffect(() => { void load(); }, [load]);

  async function answer(item: MorningCardItem, verdict: 'have' | 'low' | 'out') {
    if (!state.token || busy) return;
    setBusy(item.productId);
    try {
      await SellerApi.verifyShelf(item.productId, verdict, undefined, state.token);
      setItems((prev) => prev.filter((i) => i.productId !== item.productId));
    } catch (e) {
      console.error('Verify failed:', e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>स्टॉक चेक ☀️</Text>
          <Text style={styles.headerSub}>शेल्फ़ देखकर बताएं — 1 मिनट</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.accent} size="large" /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.doneEmoji}>✅</Text>
          <Text style={styles.doneText}>सब verify हो गया!</Text>
          <Text style={styles.doneSub}>आज के लिए कोई item check नहीं करना</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.productId}
          contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.md }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                {item.imageUrl
                  ? <Image source={{ uri: item.imageUrl }} style={styles.thumb} />
                  : <View style={[styles.thumb, styles.thumbEmpty]}><Text>📦</Text></View>}
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
                  <Text style={styles.meta}>App में: {item.expectedQty} pieces</Text>
                </View>
              </View>
              <View style={styles.btnRow}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnHave]}
                  disabled={busy === item.productId}
                  onPress={() => void answer(item, 'have')}
                >
                  <Text style={styles.btnText}>बहुत है</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnLow]}
                  disabled={busy === item.productId}
                  onPress={() => void answer(item, 'low')}
                >
                  <Text style={styles.btnText}>कम है</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnOut]}
                  disabled={busy === item.productId}
                  onPress={() => void answer(item, 'out')}
                >
                  <Text style={styles.btnText}>नहीं है</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.md },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingTop: 56, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md,
    backgroundColor: Colors.primary,
  },
  backBtn:     { padding: Spacing.sm },
  backText:    { color: Colors.white, fontSize: FontSize.xl, fontWeight: '800' },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.white },
  headerSub:   { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.8)' },
  doneEmoji:   { fontSize: 64 },
  doneText:    { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  doneSub:     { fontSize: FontSize.md, color: Colors.textMuted },
  card: {
    backgroundColor: Colors.card, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.md, ...Shadow.card,
  },
  cardTop:    { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  thumb:      { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.background },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  name:       { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  meta:       { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 2 },
  btnRow:     { flexDirection: 'row', gap: Spacing.sm },
  btn:        { flex: 1, borderRadius: Radius.md, paddingVertical: Spacing.md, alignItems: 'center' },
  btnHave:    { backgroundColor: Colors.success },
  btnLow:     { backgroundColor: Colors.warning },
  btnOut:     { backgroundColor: Colors.error },
  btnText:    { color: Colors.white, fontWeight: '800', fontSize: FontSize.md },
});
