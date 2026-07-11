import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  Keyboard, ScrollView, AccessibilityInfo,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Spacing, FontSize, Radius } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';
import { DotsLoader } from '../../components/ui';
import { mapAuthError } from '../../utils/authErrors';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'OtpLogin'> };

export default function OtpLoginScreen({ navigation }: Props) {
  const t = useT();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const [phone,   setPhone]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  // Synchronous re-entry lock — a double-tap must not burn two OTP sends
  // (the server budget is only a few per hour per phone).
  const submittingRef = useRef(false);

  const isValid = /^[6-9]\d{9}$/.test(phone);
  // Only complain once a full number is typed and still doesn't validate.
  const invalidHint = phone.length === 10 && !isValid ? t('auth.invalidPhone') : null;

  // Autofill/paste can deliver "+91 98765 43210" — keep digits, drop the 91
  // country prefix, cap at 10 so validation sees the number the user meant.
  const onChangePhone = (v: string) => {
    const digits = v.replace(/\D/g, '');
    const local  = digits.length > 10 && digits.startsWith('91') ? digits.slice(-10) : digits.slice(0, 10);
    setPhone(local);
    if (error) setError(null);
  };

  async function handleSendOtp() {
    if (!isValid || submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await api.sendOtp({ phone });
      navigation.navigate('VerifyOtp', { phone, expiresInSeconds: result.expiresInSeconds });
    } catch (err: unknown) {
      const msg = mapAuthError(err, t);
      setError(msg);
      AccessibilityInfo.announceForAccessibility(msg);
    } finally {
      setLoading(false);
      submittingRef.current = false;
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
              autoComplete="tel"
              textContentType="telephoneNumber"
              maxLength={10}
              value={phone}
              onChangeText={onChangePhone}
              returnKeyType="done"
              blurOnSubmit={false}
              onSubmitEditing={() => { if (isValid) void handleSendOtp(); else Keyboard.dismiss(); }}
              editable={!loading}
              autoFocus
              accessibilityLabel={t('auth.phoneLabel')}
            />
          </View>

          {/* Inline status — replaces the old Alert dialogs */}
          {(error ?? invalidHint) && (
            <Text style={styles.errorText} accessibilityLiveRegion="polite">
              {error ?? invalidHint}
            </Text>
          )}

          <TouchableOpacity
            style={[styles.btn, (!isValid || loading) && styles.btnDisabled]}
            onPress={() => void handleSendOtp()}
            disabled={!isValid || loading}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('auth.sendOtp')}
            accessibilityState={{ disabled: !isValid || loading, busy: loading }}
          >
            {loading
              ? <DotsLoader color={Colors.white} size={8} />
              : <Text style={styles.btnText}>{t('auth.sendOtp')}</Text>
            }
          </TouchableOpacity>

          <Text style={styles.terms}>{t('auth.terms')}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
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
    // Theme surface (not hardcoded white) so digits stay visible in dark mode.
    backgroundColor: Colors.card, borderWidth: 1.5,
    borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, justifyContent: 'center',
    minHeight: 52,
  },
  countryCodeText: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text },
  phoneInput: {
    flex: 1, backgroundColor: Colors.card, borderWidth: 1.5,
    borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, fontSize: FontSize.xl,
    fontWeight: '600', color: Colors.text, minHeight: 52,
  },
  errorText: {
    fontSize: FontSize.sm, color: Colors.error,
    marginTop: -Spacing.sm, lineHeight: 18,
  },
  btn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    height: 54, justifyContent: 'center', alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText:     { color: Colors.white, fontSize: FontSize.lg, fontWeight: '700' },
  terms:       { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center', lineHeight: 18 },
});
