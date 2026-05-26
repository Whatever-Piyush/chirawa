import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Colors, Spacing, FontSize, Radius } from '../../theme';
import { SellerApi } from '../../services/api.service';
import { useT } from '@chirawa/i18n';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'OtpLogin'> };

export default function OtpLoginScreen({ navigation }: Props) {
  const t = useT();
  const [phone, setPhone]     = useState('');
  const [loading, setLoading] = useState(false);
  const isValid = /^[6-9]\d{9}$/.test(phone);

  async function handleSend() {
    if (!isValid) return;
    setLoading(true);
    try {
      await SellerApi.sendOtp(phone);
      navigation.navigate('VerifyOtp', { phone });
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.content}>
        <Text style={styles.emoji}>🏪</Text>
        <Text style={styles.title}>{t('auth.sellerLogin')}</Text>
        <Text style={styles.subtitle}>{t('auth.sellerTagline')}</Text>

        <TextInput
          style={styles.input}
          placeholder={t('auth.mobileNumber')}
          placeholderTextColor={Colors.textMuted}
          keyboardType="phone-pad"
          maxLength={10}
          value={phone}
          onChangeText={setPhone}
          autoFocus
        />

        <TouchableOpacity
          style={[styles.btn, !isValid && styles.btnOff]}
          onPress={handleSend}
          disabled={!isValid || loading}
        >
          {loading
            ? <ActivityIndicator color={Colors.white} />
            : <Text style={styles.btnText}>{t('auth.sendOtp')}</Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content:   { flex: 1, justifyContent: 'center', padding: Spacing.xl, gap: Spacing.lg },
  emoji:     { fontSize: 64, textAlign: 'center' },
  title:     { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  subtitle:  { fontSize: FontSize.md, color: Colors.textLight, textAlign: 'center' },
  input: {
    backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: Radius.md, padding: Spacing.lg, fontSize: FontSize.xl,
    fontWeight: '600', color: Colors.text,
  },
  btn:    { backgroundColor: Colors.primary, borderRadius: Radius.md, height: 54, justifyContent: 'center', alignItems: 'center' },
  btnOff: { opacity: 0.5 },
  btnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '700' },
});
