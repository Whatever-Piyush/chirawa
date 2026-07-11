import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ScrollView,
  Animated, AccessibilityInfo,
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
import { mapAuthError } from '../../utils/authErrors';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'VerifyOtp'>;
  route:      RouteProp<RootStackParamList, 'VerifyOtp'>;
};

const RESEND_COOLDOWN_S = 30;  // client-side politeness gate before Resend unlocks
const DEFAULT_OTP_TTL_S = 300; // mirrors the server's 5-minute OTP validity

function fmtMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function VerifyOtpScreen({ navigation, route }: Props) {
  const { phone, expiresInSeconds } = route.params;
  const { signIn }     = useAuth();
  const t              = useT();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  const [otp, setOtp]             = useState(__DEV__ ? '123456' : '');
  const [loading, setLoading]     = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [notice, setNotice]       = useState<string | null>(null); // "New OTP sent ✓"

  // Countdown + validity derive from absolute timestamps, so backgrounding the
  // app (taking a call, reading the SMS) never desyncs them — the 1s interval
  // below only forces re-renders.
  const [resendAt,  setResendAt]  = useState(() => Date.now() + RESEND_COOLDOWN_S * 1000);
  const [expiresAt, setExpiresAt] = useState(
    () => Date.now() + (expiresInSeconds ?? DEFAULT_OTP_TTL_S) * 1000,
  );
  const [, setTick] = useState(0);

  const inputRef      = useRef<TextInput>(null);
  // Synchronous re-entry lock: auto-submit on the 6th digit and a button tap
  // must never race into two verify calls (each failure burns an OTP attempt).
  const submittingRef = useRef(false);
  const noticeTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shake         = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      clearInterval(id);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  const now           = Date.now();
  const resendWaitS   = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const expiryRemainS = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const expired       = expiryRemainS <= 0;
  const canResend     = resendWaitS <= 0 && !resending && !loading;

  const runShake = useCallback(() => {
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: 1,  duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 1,  duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0,  duration: 50, useNativeDriver: true }),
    ]).start();
  }, [shake]);

  const showError = useCallback((msg: string) => {
    setError(msg);
    runShake();
    AccessibilityInfo.announceForAccessibility(msg);
  }, [runShake]);

  const handleVerify = useCallback(async (code: string) => {
    if (code.length !== 6 || submittingRef.current) return;
    // Past the 5-minute validity the server is guaranteed to reject — fail fast
    // with the actionable message. (Dev bypass 123456 has no expiry, so skip.)
    if (expired && !__DEV__) {
      showError(t('auth.otpExpired'));
      setOtp('');
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const response = await api.verifyOtp({ phone, otp: code });
      const payload = JSON.parse(
        atob(response.tokens.accessToken.split('.')[1] ?? ''),
      ) as { sub: string; role: string };
      // Returning user on a fresh install: their name lives server-side —
      // hydrate it so the profile-setup gate doesn't re-onboard them.
      // Best-effort: on failure they just see the setup screen as before.
      let serverName: string | null = null;
      try {
        const me = await api.getMe();
        serverName =
          [me.profile?.firstName, me.profile?.lastName].filter(Boolean).join(' ') || null;
      } catch { /* tolerate — setup gate handles the null-name case */ }
      signIn(payload.sub, payload.role, phone, serverName);
    } catch (err: unknown) {
      showError(mapAuthError(err, t));
      setOtp('');
      inputRef.current?.focus(); // keep the keyboard up for the retry
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }, [expired, phone, signIn, t, showError]);

  const handleResend = useCallback(async () => {
    if (!canResend) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.sendOtp({ phone });
      // A resend voids the previous code server-side — reset entry + timers.
      setResendAt(Date.now() + RESEND_COOLDOWN_S * 1000);
      setExpiresAt(Date.now() + (result.expiresInSeconds ?? DEFAULT_OTP_TTL_S) * 1000);
      setOtp('');
      inputRef.current?.focus();
      setNotice(t('auth.otpSentAgain'));
      AccessibilityInfo.announceForAccessibility(t('auth.otpSentAgain'));
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), 4000);
    } catch (err: unknown) {
      showError(mapAuthError(err, t));
    } finally {
      setResending(false);
    }
  }, [canResend, phone, t, showError]);

  // Pass the fresh digits straight to verify — reading `otp` state here would
  // see the pre-keystroke value and the auto-submit would silently no-op.
  const onChangeOtp = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 6);
    setOtp(digits);
    if (error) setError(null);
    if (digits.length === 6) void handleVerify(digits);
  };

  const shakeStyle = {
    transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-8, 8] }) }],
  };

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

        <Animated.View style={shakeStyle}>
          <TextInput
            ref={inputRef}
            style={[styles.otpInput, !!error && styles.otpInputError]}
            placeholder="• • • • • •"
            placeholderTextColor={Colors.textMuted}
            keyboardType="number-pad"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={6}
            value={otp}
            onChangeText={onChangeOtp}
            editable={!loading}
            autoFocus
            accessibilityLabel={t('auth.enterOtp')}
            accessibilityHint={`${t('auth.otpSentMessage')} +91 ${phone}`}
          />
        </Animated.View>
        {__DEV__ && <Text style={styles.devHint}>Dev mode: OTP pre-filled</Text>}

        {/* Inline status line — error > resend confirmation > code validity */}
        {error ? (
          <Text style={styles.errorText} accessibilityLiveRegion="polite">{error}</Text>
        ) : notice ? (
          <Text style={styles.noticeText} accessibilityLiveRegion="polite">{notice}</Text>
        ) : expired ? (
          <Text style={styles.errorText} accessibilityLiveRegion="polite">{t('auth.otpExpired')}</Text>
        ) : (
          <Text style={styles.validityText}>
            {t('auth.otpValidFor').replace('{t}', fmtMmSs(expiryRemainS))}
          </Text>
        )}

        <TouchableOpacity
          style={[styles.btn, (otp.length !== 6 || loading) && styles.btnDisabled]}
          onPress={() => void handleVerify(otp)}
          disabled={otp.length !== 6 || loading}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={t('auth.verifyOtp')}
          accessibilityState={{ disabled: otp.length !== 6 || loading, busy: loading }}
        >
          {loading
            ? <DotsLoader color={Colors.white} size={8} />
            : <Text style={styles.btnText}>{t('auth.verifyOtp')}</Text>
          }
        </TouchableOpacity>

        {/* Resend block — countdown, then an active Resend OTP link */}
        <View style={styles.resendBlock}>
          <Text style={styles.noSmsText}>{t('auth.noSmsHint')}</Text>
          <TouchableOpacity
            onPress={() => void handleResend()}
            disabled={!canResend}
            hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
            accessibilityRole="button"
            accessibilityLabel={t('auth.resendOtp')}
            accessibilityState={{ disabled: !canResend, busy: resending }}
          >
            {resending ? (
              <DotsLoader color={Colors.primary} size={6} />
            ) : (
              <Text style={[styles.resendText, !canResend && styles.resendTextDisabled]}>
                {resendWaitS > 0
                  ? t('auth.resendIn').replace('{s}', String(resendWaitS))
                  : t('auth.resendOtp')}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={t('auth.changeNumber')}
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
  content:   { flexGrow: 1, justifyContent: 'center', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.xxl, gap: Spacing.lg },
  title:     { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text },
  subtitle:  { fontSize: FontSize.md, color: Colors.textLight, lineHeight: 22 },
  otpInput: {
    // Theme surface (not hardcoded white) so digits stay visible in dark mode.
    backgroundColor: Colors.card, borderWidth: 2,
    borderColor: Colors.primary, borderRadius: Radius.md,
    padding: Spacing.lg, fontSize: FontSize.xxxl,
    fontWeight: '700', color: Colors.text,
    textAlign: 'center', letterSpacing: 12,
  },
  otpInputError: { borderColor: Colors.error },
  errorText:    { fontSize: FontSize.sm, color: Colors.error, textAlign: 'center', lineHeight: 19 },
  noticeText:   { fontSize: FontSize.sm, color: Colors.success, textAlign: 'center', fontWeight: '700' },
  validityText: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },
  btn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    height: 54, justifyContent: 'center', alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText:     { color: Colors.white, fontSize: FontSize.lg, fontWeight: '700' },
  resendBlock: { alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.xs },
  noSmsText:   { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
  resendText:  { color: Colors.primary, fontSize: FontSize.md, fontWeight: '700', paddingVertical: 4 },
  resendTextDisabled: { color: Colors.textMuted, fontWeight: '600' },
  backBtn:     { alignItems: 'center' },
  backText:    { color: Colors.primary, fontSize: FontSize.md, fontWeight: '600' },
  devHint:     { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
});
