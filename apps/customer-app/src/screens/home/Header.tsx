import React from 'react';
import { View, TouchableOpacity, StyleSheet, Animated, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text, FauxGradient } from '../../components/ui';
import { Colors, Spacing } from '../../theme';
import { useT } from '@chirawa/i18n';
import { useAuth } from '../../context/AuthContext';
import { NIGHT_FROM, NIGHT_TO } from './nightTheme';
import Starfield from './Starfield';
import Planet from './Planet';
import type { TextStyle } from 'react-native';

const HEADER_BLEED = 28; // bottom padding so the SearchBar can overlap upward

// A scattered star map for the night header — spread across the width with
// varied brightness + a few tints, kept low-opacity so they sit behind the
// ETA / address / profile content.
const HEADER_STARS: TextStyle[] = [
  { top: 8,  left: 30,   fontSize: 9,  opacity: 0.55 },
  { top: 20, left: 92,   fontSize: 5,  opacity: 0.32 },
  { top: 6,  left: 150,  fontSize: 7,  opacity: 0.42, color: '#BFD0FF' },
  { top: 26, left: 210,  fontSize: 4,  opacity: 0.28 },
  { top: 12, left: 255,  fontSize: 11, opacity: 0.65 },
  { top: 38, left: 130,  fontSize: 5,  opacity: 0.30 },
  { top: 50, left: 60,   fontSize: 6,  opacity: 0.34 },
  { top: 66, left: 140,  fontSize: 7,  opacity: 0.40, color: '#E2D2FF' },
  { top: 58, left: 230,  fontSize: 5,  opacity: 0.30 },
  { top: 84, left: 100,  fontSize: 4,  opacity: 0.26 },
  { top: 14, right: 80,  fontSize: 6,  opacity: 0.36 },
  { top: 34, right: 120, fontSize: 8,  opacity: 0.46 },
  { top: 22, right: 200, fontSize: 5,  opacity: 0.30, color: '#FFF1C9' },
  { top: 80, right: 30,  fontSize: 6,  opacity: 0.32 },
  { top: 70, right: 150, fontSize: 5,  opacity: 0.30 },
  { top: 96, right: 90,  fontSize: 4,  opacity: 0.24 },
  { bottom: 44, left: 40,  fontSize: 7, opacity: 0.42 },
  { bottom: 30, left: 180, fontSize: 5, opacity: 0.30, color: '#BFD0FF' },
  { bottom: 16, left: 100, fontSize: 6, opacity: 0.36 },
  { bottom: 50, left: 250, fontSize: 4, opacity: 0.26 },
  { bottom: 48, right: 70, fontSize: 9, opacity: 0.50 },
  { bottom: 26, right: 150,fontSize: 5, opacity: 0.30 },
  { bottom: 34, right: 30, fontSize: 7, opacity: 0.42 },
  { bottom: 18, right: 210,fontSize: 4, opacity: 0.26 },
];

interface Props {
  onProfilePress:  () => void;
  onLocationPress: () => void;
  addressLine?:    string | null;
  style?:          ViewStyle;
  entranceOpacity?: Animated.Value;
  /** When true (store closed) the header wears the night theme instead of orange. */
  night?:          boolean;
}

export default function Header({
  onProfilePress, onLocationPress, addressLine, style, entranceOpacity, night = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const t = useT();
  const { state } = useAuth();

  const name = state.name ?? '';

  return (
    <Animated.View
      style={[
        styles.header,
        night && styles.headerNight,
        { paddingTop: insets.top + Spacing.md },
        entranceOpacity ? { opacity: entranceOpacity } : null,
        style,
      ]}
    >
      {/* Night background, stars + planets — behind the content so taps land. */}
      {night && (
        <>
          <FauxGradient from={NIGHT_FROM} to={NIGHT_TO} steps={18} style={StyleSheet.absoluteFill} />
          <Starfield stars={HEADER_STARS} />
          <Planet kind="saturn"  size={50} style={{ top: insets.top + 2,  right: 112, opacity: 0.82 }} />
          <Planet kind="jupiter" size={22} style={{ top: insets.top + 58, right: 40,  opacity: 0.66 }} />
        </>
      )}

      {/* Row 1 — delivery promise + profile avatar */}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text color="rgba(255,255,255,0.8)" weight="medium" style={styles.brandIn}>
            {t('home.brandInLabel')}
          </Text>
          <View style={styles.etaRow}>
            <Text color={Colors.white} weight="bold" style={styles.eta}>
              {t('home.etaMinutes')}
            </Text>
            <View style={styles.etaChip}>
              <Ionicons name="flash" size={11} color={Colors.white} />
              <Text color={Colors.white} weight="bold" style={styles.etaChipText}>24×7</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          onPress={onProfilePress}
          activeOpacity={0.7}
          style={styles.profileBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Profile"
        >
          <Text style={styles.avatarText}>
            {state.name ? state.name.charAt(0).toUpperCase() : '?'}
          </Text>
          <View style={[styles.activeDot, night && { borderColor: NIGHT_FROM }]} />
        </TouchableOpacity>
      </View>

      {/* Row 2 — tappable delivery address → opens the location sheet */}
      <TouchableOpacity
        onPress={onLocationPress}
        activeOpacity={0.7}
        style={styles.addrRow}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        accessibilityLabel="Change delivery location"
      >
        <Ionicons name="location-sharp" size={16} color={Colors.white} />
        <Text color={Colors.white} weight="bold" style={styles.addrName} numberOfLines={1}>
          {name ? `${name}` : t('home.setLocation')}
          {name && addressLine ? (
            <Text color="rgba(255,255,255,0.8)" weight="regular" style={styles.addrText}>
              {`  ·  ${addressLine}`}
            </Text>
          ) : null}
        </Text>
        <Ionicons name="chevron-down" size={16} color={Colors.white} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingBottom: HEADER_BLEED,
    overflow: 'hidden',          // clip the absolute night gradient to the header
  },
  headerNight: {
    backgroundColor: NIGHT_FROM, // fallback base behind the gradient
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  brandIn: {
    fontSize: 12.5,
    lineHeight: 16,
    letterSpacing: 0.2,
  },
  etaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  eta: {
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  etaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginTop: 4,
  },
  etaChipText: {
    fontSize: 11,
    letterSpacing: 0.3,
  },
  profileBtn: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 19,
    fontFamily: 'Poppins_700Bold',
    color: Colors.white,
    marginTop: 2,
  },
  activeDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#34C759',
    borderWidth: 2.5,
    borderColor: Colors.primary,
  },
  addrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.md,
  },
  addrName: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
  },
  addrText: {
    fontSize: 13,
    lineHeight: 19,
  },
});
