import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Colors, Spacing, FontSize, Radius } from '../../theme';
import { SellerApi } from '../../services/api.service';
import { useAuth } from '../../context/AuthContext';

type Props = { route: RouteProp<RootStackParamList, 'SetPin'> };

export default function SetPinScreen({ route }: Props) {
  const { token }       = route.params;
  const { pinSet }      = useAuth();
  const [pin, setPin]   = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSetPin() {
    if (pin.length !== 4) return;
    setLoading(true);
    try {
      await SellerApi.setPin(pin, token);
      pinSet();
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'PIN set nahi hua');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.emoji}>🔐</Text>
        <Text style={styles.title}>Security PIN Set Karein</Text>
        <Text style={styles.sub}>4-digit PIN jo aap login pe use karenge</Text>
        <TextInput
          style={styles.input}
          placeholder="• • • •"
          placeholderTextColor={Colors.textMuted}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          value={pin}
          onChangeText={(v) => { setPin(v); if (v.length === 4) void handleSetPin(); }}
          autoFocus
        />
        <TouchableOpacity
          style={[styles.btn, pin.length !== 4 && styles.btnOff]}
          onPress={handleSetPin}
          disabled={pin.length !== 4 || loading}
        >
          {loading ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.btnText}>PIN Set Karein</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content:   { flex: 1, justifyContent: 'center', padding: Spacing.xl, gap: Spacing.xl },
  emoji:     { fontSize: 64, textAlign: 'center' },
  title:     { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  sub:       { fontSize: FontSize.md, color: Colors.textLight, textAlign: 'center' },
  input: {
    backgroundColor: Colors.white, borderWidth: 2, borderColor: Colors.accent,
    borderRadius: Radius.md, padding: Spacing.lg, fontSize: FontSize.xxxl,
    fontWeight: '700', textAlign: 'center', letterSpacing: 16, color: Colors.text,
  },
  btn:     { backgroundColor: Colors.accent, borderRadius: Radius.md, height: 54, justifyContent: 'center', alignItems: 'center' },
  btnOff:  { opacity: 0.5 },
  btnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '700' },
});
