import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Colors, Spacing, FontSize, Radius } from '../../theme';
import { SellerApi } from '../../services/api.service';
import { StorageService } from '../../services/storage.service';
import { useAuth } from '../../context/AuthContext';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'VerifyOtp'>;
  route:      RouteProp<RootStackParamList, 'VerifyOtp'>;
};

export default function VerifyOtpScreen({ route }: Props) {
  const { phone }      = route.params;
  const { signIn }     = useAuth();
  const [otp, setOtp]  = useState('');
  const [loading, setLoading] = useState(false);

  async function handleVerify() {
    if (otp.length !== 6) return;
    setLoading(true);
    try {
      const res = await SellerApi.verifyOtp(phone, otp);
      await StorageService.setTokens({
        accessToken: res.tokens.accessToken,
        refreshToken: res.tokens.refreshToken,
        expiresIn: 900,
      });
      const payload = JSON.parse(atob(res.tokens.accessToken.split('.')[1] ?? '')) as { sub: string };
      signIn(res.tokens.accessToken, payload.sub, res.requiresPin);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Galat OTP');
      setOtp('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>OTP Dalein</Text>
        <Text style={styles.sub}>+91 {phone} pe bheja gaya</Text>
        <TextInput
          style={styles.input}
          placeholder="• • • • • •"
          placeholderTextColor={Colors.textMuted}
          keyboardType="number-pad"
          maxLength={6}
          value={otp}
          onChangeText={(v) => { setOtp(v); if (v.length === 6) void handleVerify(); }}
          autoFocus
        />
        <TouchableOpacity
          style={[styles.btn, otp.length !== 6 && styles.btnOff]}
          onPress={handleVerify}
          disabled={otp.length !== 6 || loading}
        >
          {loading ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.btnText}>Verify</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content:   { flex: 1, justifyContent: 'center', padding: Spacing.xl, gap: Spacing.xl },
  title:     { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text },
  sub:       { fontSize: FontSize.md, color: Colors.textLight },
  input: {
    backgroundColor: Colors.white, borderWidth: 2, borderColor: Colors.accent,
    borderRadius: Radius.md, padding: Spacing.lg, fontSize: FontSize.xxxl,
    fontWeight: '700', textAlign: 'center', letterSpacing: 12, color: Colors.text,
  },
  btn:    { backgroundColor: Colors.accent, borderRadius: Radius.md, height: 54, justifyContent: 'center', alignItems: 'center' },
  btnOff: { opacity: 0.5 },
  btnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '700' },
});
