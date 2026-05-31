import React, { useMemo, useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert,
  KeyboardAvoidingView, Platform, Keyboard, ScrollView,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Spacing, FontSize, Radius } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { api } from '../../services/api.service';
import { useAuth } from '../../context/AuthContext';
import { useT } from '@chirawa/i18n';
import { DotsLoader } from '../../components/ui';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'VerifyOtp'>;
  route:      RouteProp<RootStackParamList, 'VerifyOtp'>;
};

export default function VerifyOtpScreen({ navigation, route }: Props) {
  const { phone }      = route.params;
  const { signIn }     = useAuth();
  const t              = useT();
  const [otp, setOtp]  = useState(__DEV__ ? '123456' : '');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  async function handleVerify() {
    if (otp.length !== 6) return;
    setLoading(true);
    try {
      const response = await api.verifyOtp({ phone, otp });
      const payload = JSON.parse(
        atob(response.tokens.accessToken.split('.')[1] ?? ''),
      ) as { sub: string; role: string };
      signIn(payload.sub, payload.role, phone);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('auth.wrongOtp');
      Alert.alert(t('common.error'), msg);
      setOtp('');
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

        <Text style={styles.title}>{t('auth.verifyOtp')}</Text>
        <Text style={styles.subtitle}>
          {t('auth.otpSentMessage')} +91 {phone}
        </Text>

        <TextInput
          ref={inputRef}
          style={styles.otpInput}
          placeholder="• • • • • •"
          placeholderTextColor={Colors.textMuted}
          keyboardType="number-pad"
          maxLength={6}
          value={otp}
          onChangeText={(v) => {
            setOtp(v);
            if (v.length === 6) void handleVerify();
          }}
          returnKeyType="done"
          blurOnSubmit={true}
          onSubmitEditing={() => Keyboard.dismiss()}
          autoFocus
        />
        {__DEV__ && <Text style={styles.devHint}>Dev mode: OTP pre-filled</Text>}

        <TouchableOpacity
          style={[styles.btn, otp.length !== 6 && styles.btnDisabled]}
          onPress={handleVerify}
          disabled={otp.length !== 6 || loading}
          activeOpacity={0.8}
        >
          {loading
            ? <DotsLoader color={Colors.white} size={8} />
            : <Text style={styles.btnText}>{t('auth.verifyOtp')}</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
        >
          <Text style={styles.backText}>{t('auth.changeNumber')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content:   { flexGrow: 1, justifyContent: 'center', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.xxl, gap: Spacing.xl },
  title:     { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text },
  subtitle:  { fontSize: FontSize.md, color: Colors.textLight, lineHeight: 22 },
  otpInput: {
    backgroundColor: Colors.white, borderWidth: 2,
    borderColor: Colors.primary, borderRadius: Radius.md,
    padding: Spacing.lg, fontSize: FontSize.xxxl,
    fontWeight: '700', color: Colors.text,
    textAlign: 'center', letterSpacing: 12,
  },
  btn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    height: 54, justifyContent: 'center', alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText:     { color: Colors.white, fontSize: FontSize.lg, fontWeight: '700' },
  backBtn:     { alignItems: 'center' },
  backText:    { color: Colors.primary, fontSize: FontSize.md, fontWeight: '600' },
  devHint:     { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
});
