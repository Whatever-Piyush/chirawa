import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Colors, FontSize, Spacing, Radius } from '../../theme';
import { useAuth } from '../../context/AuthContext';

export default function ProfileScreen() {
  const { signOut } = useAuth();
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.emoji}>🏪</Text>
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
  content:    { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.xl },
  emoji:      { fontSize: 64 },
  logoutBtn:  { backgroundColor: Colors.error, borderRadius: Radius.md, paddingVertical: 14, paddingHorizontal: 48 },
  logoutText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '700' },
});
