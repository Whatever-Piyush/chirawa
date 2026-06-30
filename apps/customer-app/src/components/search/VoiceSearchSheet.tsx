import React, { useEffect, useMemo, useRef } from 'react';
import {
  View, Modal, Pressable, StyleSheet, Animated, Easing, Linking, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useT, useLanguage } from '@chirawa/i18n';
import { Text } from '../ui';
import { FontSize, Radius, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { useVoiceSearch, type VoiceStatus } from '../../hooks/useVoiceSearch';

// ─── Voice search listening sheet (Blinkit/Google-style) ─────────────────────
// Centered modal: pulsing mic + volume-reactive waveform, live transcript, and
// permission / no-match / error states. Auto-starts on open, auto-runs the
// search on a final transcript via onResult.

interface VoiceSearchSheetProps {
  visible: boolean;
  contextualStrings?: string[];        // catalog terms → recognition bias
  requiresOnDeviceRecognition?: boolean;
  onClose: () => void;
  onResult: (text: string) => void;    // final transcript → screen runs search
}

const BARS = 5;
const BAR_MIN = 6;
const BAR_MAX = 40;

function langToBcp47(forced: 'hi' | 'en' | null, appLang: 'hi' | 'en'): string {
  const l = forced ?? appLang;
  return l === 'hi' ? 'hi-IN' : 'en-IN';
}

export default function VoiceSearchSheet({
  visible, contextualStrings, requiresOnDeviceRecognition, onClose, onResult,
}: VoiceSearchSheetProps) {
  const t = useT();
  const { language } = useLanguage();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  // Optional in-sheet हिं/EN override of the recognition locale.
  const [forced, setForced] = React.useState<'hi' | 'en' | null>(null);
  const lang = langToBcp47(forced, language);

  // Hand the final transcript up, then close. Wrapped so haptics fire once.
  const handleResult = React.useCallback((text: string) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    onResult(text);
    onClose();
  }, [onResult, onClose]);

  const {
    status, transcript, volume, errorCode, start, stop, cancel,
  } = useVoiceSearch({
    lang,
    contextualStrings,
    requiresOnDeviceRecognition,
    onResult: handleResult,
  });

  // ── Animations ─────────────────────────────────────────────────────────────
  const ring     = useRef(new Animated.Value(0)).current;   // continuous pulse
  const micScale = useRef(new Animated.Value(1)).current;   // volume-reactive
  const bars     = useRef(Array.from({ length: BARS }, () => new Animated.Value(BAR_MIN))).current;

  const listening = status === 'listening';

  // Outer ring pulse while listening.
  useEffect(() => {
    if (!listening) { ring.stopAnimation(); ring.setValue(0); return; }
    const loop = Animated.loop(
      Animated.timing(ring, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [listening, ring]);

  // Mic scale + waveform bars react to input volume.
  useEffect(() => {
    Animated.spring(micScale, {
      toValue: 1 + volume * 0.35,
      useNativeDriver: true, friction: 6, tension: 220,
    }).start();
    bars.forEach((bar, i) => {
      // Per-bar weight so the row looks organic, not a flat block.
      const weight = [0.55, 0.85, 1, 0.85, 0.55][i] ?? 0.7;
      const h = BAR_MIN + volume * (BAR_MAX - BAR_MIN) * weight;
      Animated.timing(bar, { toValue: h, duration: 90, useNativeDriver: false }).start();
    });
  }, [volume, micScale, bars]);

  // Auto-start on open; abort on close.
  useEffect(() => {
    if (visible) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      void start();
    } else {
      cancel();
      setForced(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Warning haptic when we land in an error state.
  useEffect(() => {
    if (status === 'error') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    }
  }, [status]);

  const handleClose = () => { cancel(); onClose(); };
  const retry = () => { void start(); };

  const ringStyle = {
    opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
    transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }],
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.xl }]} onPress={() => {}}>
          <View style={styles.handle} />

          {/* Language toggle (top-right) */}
          <View style={styles.langRow}>
            {(['hi', 'en'] as const).map((l) => {
              const active = (forced ?? language) === l;
              return (
                <TouchableOpacity
                  key={l}
                  style={[styles.langChip, active && styles.langChipActive]}
                  onPress={() => { setForced(l); retry(); }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.langChipText, active && styles.langChipTextActive]}>
                    {l === 'hi' ? t('voice.langHindi') : t('voice.langEnglish')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <VoiceBody
            status={status}
            errorCode={errorCode}
            transcript={transcript}
            t={t}
            Colors={Colors}
            styles={styles}
            micScale={micScale}
            ringStyle={ringStyle}
            bars={bars}
            onMicPress={status === 'error' ? retry : stop}
          />

          <TouchableOpacity style={styles.cancelBtn} onPress={handleClose} activeOpacity={0.7}>
            <Text style={styles.cancelText}>{t('voice.cancel')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Body (varies by status) ──────────────────────────────────────────────────

function VoiceBody({
  status, errorCode, transcript, t, Colors, styles, micScale, ringStyle, bars, onMicPress,
}: {
  status: VoiceStatus;
  errorCode: string | null;
  transcript: string;
  t: (k: string) => string;
  Colors: ColorPalette;
  styles: ReturnType<typeof makeStyles>;
  micScale: Animated.Value;
  ringStyle: { opacity: Animated.AnimatedInterpolation<number>; transform: { scale: Animated.AnimatedInterpolation<number> }[] };
  bars: Animated.Value[];
  onMicPress: () => void;
}) {
  // Permission denied → explain + route to Settings.
  if (status === 'error' && errorCode === 'not-allowed') {
    return (
      <View style={styles.body}>
        <View style={styles.permIcon}>
          <Ionicons name="mic-off-outline" size={34} color={Colors.error} />
        </View>
        <Text style={styles.title}>{t('voice.permTitle')}</Text>
        <Text style={styles.subtitle}>{t('voice.permBody')}</Text>
        <TouchableOpacity style={styles.settingsBtn} onPress={() => void Linking.openSettings()} activeOpacity={0.85}>
          <Text style={styles.settingsBtnText}>{t('voice.openSettings')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Other errors / no-match → retry.
  if (status === 'error') {
    return (
      <View style={styles.body}>
        <TouchableOpacity onPress={onMicPress} activeOpacity={0.85}>
          <View style={[styles.micCircle, styles.micCircleError]}>
            <Ionicons name="refresh" size={36} color={Colors.white} />
          </View>
        </TouchableOpacity>
        <Text style={styles.subtitle}>{t('voice.noMatch')}</Text>
      </View>
    );
  }

  if (status === 'processing') {
    return (
      <View style={styles.body}>
        <View style={styles.micCircle}>
          <Ionicons name="sparkles-outline" size={34} color={Colors.white} />
        </View>
        <Text style={styles.title}>{t('voice.processing')}</Text>
        {transcript ? <Text style={styles.transcript}>{transcript}</Text> : null}
      </View>
    );
  }

  // idle / listening
  return (
    <View style={styles.body}>
      <TouchableOpacity onPress={onMicPress} activeOpacity={0.85}>
        <View style={styles.micWrap}>
          <Animated.View style={[styles.ring, ringStyle]} />
          <Animated.View style={[styles.micCircle, { transform: [{ scale: micScale }] }]}>
            <Ionicons name="mic" size={38} color={Colors.white} />
          </Animated.View>
        </View>
      </TouchableOpacity>

      {/* Volume waveform */}
      <View style={styles.waveRow}>
        {bars.map((bar, i) => (
          <Animated.View key={i} style={[styles.waveBar, { height: bar }]} />
        ))}
      </View>

      <Text style={styles.title}>{t('voice.listening')}</Text>
      <Text style={styles.transcript}>
        {transcript || t('voice.speakNow')}
      </Text>
      <Text style={styles.hint}>{t('voice.tapToStop')}</Text>
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: Colors.surface,
      borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
      paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm,
      alignItems: 'center',
    },
    handle: {
      alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
      backgroundColor: Colors.border, marginBottom: Spacing.sm,
    },
    langRow: { flexDirection: 'row', alignSelf: 'flex-end', gap: Spacing.xs, marginBottom: Spacing.sm },
    langChip: {
      paddingHorizontal: Spacing.md, paddingVertical: 5, borderRadius: Radius.full,
      backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.border,
    },
    langChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
    langChipText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary },
    langChipTextActive: { color: Colors.white },

    body: { alignItems: 'center', paddingVertical: Spacing.lg, gap: Spacing.md, minHeight: 240, justifyContent: 'center' },

    micWrap: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
    ring: {
      position: 'absolute', width: 96, height: 96, borderRadius: 48,
      backgroundColor: Colors.primary,
    },
    micCircle: {
      width: 84, height: 84, borderRadius: 42,
      backgroundColor: Colors.primary,
      alignItems: 'center', justifyContent: 'center',
    },
    micCircleError: { backgroundColor: Colors.textMuted },

    waveRow: { flexDirection: 'row', alignItems: 'center', gap: 5, height: BAR_MAX, marginTop: Spacing.xs },
    waveBar: { width: 5, borderRadius: 3, backgroundColor: Colors.primary },

    permIcon: {
      width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.successLight,
      alignItems: 'center', justifyContent: 'center',
    },

    title:    { fontSize: FontSize.lg, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
    subtitle: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', paddingHorizontal: Spacing.lg, lineHeight: 22 },
    transcript: {
      fontSize: FontSize.lg, fontWeight: '600', color: Colors.textPrimary,
      textAlign: 'center', paddingHorizontal: Spacing.lg, minHeight: 26,
    },
    hint: { fontSize: FontSize.sm, color: Colors.textTertiary },

    settingsBtn: {
      marginTop: Spacing.sm, backgroundColor: Colors.primary,
      borderRadius: Radius.full, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    },
    settingsBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '800' },

    cancelBtn: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, marginTop: Spacing.xs },
    cancelText: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textSecondary },
  });
