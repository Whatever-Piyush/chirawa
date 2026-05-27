import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  Alert, ActivityIndicator, Keyboard, ScrollView,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Colors, Spacing, FontSize, Radius } from '../../theme';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'OtpLogin'> };

export default function OtpLoginScreen({ navigation }: Props) {
  const t = useT();
  const [phone,   setPhone]   = useState('');
  const [loading, setLoading] = useState(false);

  const isValid = /^[6-9]\d{9}$/.test(phone);

  async function handleSendOtp() {
    if (!isValid) return;
    setLoading(true);
    try {
      await api.sendOtp({ phone });
      navigation.navigate('VerifyOtp', { phone });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.error');
      Alert.alert(t('common.error'), msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* Logo */}
        <View style={styles.logoBox}>
          <Text style={styles.logoEmoji}>🛵</Text>
          <Text style={styles.logoText}>Bringly</Text>
          <Text style={styles.logoSub}>{t('auth.tagline')}</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.label}>{t('auth.phoneLabel')}</Text>

          <View style={styles.phoneRow}>
            <View style={styles.countryCode}>
              <Text style={styles.countryCodeText}>+91</Text>
            </View>
            <TextInput
              style={styles.phoneInput}
              placeholder="9876543210"
              placeholderTextColor={Colors.textMuted}
              keyboardType="phone-pad"
              maxLength={10}
              value={phone}
              onChangeText={setPhone}
              returnKeyType="done"
              blurOnSubmit={true}
              onSubmitEditing={() => Keyboard.dismiss()}
              autoFocus
            />
          </View>

          <TouchableOpacity
            style={[styles.btn, !isValid && styles.btnDisabled]}
            onPress={handleSendOtp}
            disabled={!isValid || loading}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color={Colors.white} />
              : <Text style={styles.btnText}>{t('auth.sendOtp')}</Text>
            }
          </TouchableOpacity>

          <Text style={styles.terms}>{t('auth.terms')}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content:   { flexGrow: 1, justifyContent: 'center', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.xxl },
  logoBox:   { alignItems: 'center', marginBottom: Spacing.xxxl },
  logoEmoji: { fontSize: 64, marginBottom: Spacing.sm },
  logoText:  { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.primary },
  logoSub:   { fontSize: FontSize.md, color: Colors.textLight, marginTop: 4 },
  form:      { gap: Spacing.lg },
  label:     { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text },
  phoneRow:  { flexDirection: 'row', gap: Spacing.sm },
  countryCode: {
    backgroundColor: Colors.white, borderWidth: 1.5,
    borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, justifyContent: 'center',
    minHeight: 52,
  },
  countryCodeText: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text },
  phoneInput: {
    flex: 1, backgroundColor: Colors.white, borderWidth: 1.5,
    borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, fontSize: FontSize.xl,
    fontWeight: '600', color: Colors.text, minHeight: 52,
  },
  btn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    height: 54, justifyContent: 'center', alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText:     { color: Colors.white, fontSize: FontSize.lg, fontWeight: '700' },
  terms:       { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center', lineHeight: 18 },
});
