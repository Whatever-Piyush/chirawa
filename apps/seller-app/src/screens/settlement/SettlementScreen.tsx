import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, FontSize, Spacing } from '../../theme';

export default function SettlementScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settlement</Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.emoji}>💰</Text>
        <Text style={styles.text}>Kal ka payment ₹0</Text>
        <Text style={styles.sub}>Settlement Step 10 mein scheduled hai</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingTop: 56, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md, backgroundColor: Colors.primary },
  title:   { fontSize: FontSize.xl, fontWeight: '800', color: Colors.white },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.md },
  emoji:   { fontSize: 64 },
  text:    { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  sub:     { fontSize: FontSize.sm, color: Colors.textMuted },
});
