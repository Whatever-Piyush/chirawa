import React from 'react';
import { View, StyleSheet, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '@chirawa/i18n';
import { Text, FauxGradient } from '../../components/ui';
import { Spacing, Shadow } from '../../theme';
import { NIGHT_FROM, NIGHT_TO } from './nightTheme';
import Starfield from './Starfield';

// Scattered little stars (position + size + opacity). Kept varied and subtle so
// the starfield reads as a night sky rather than a pattern.
const STARS: TextStyle[] = [
  { top: 10, left: 60,   fontSize: 10, opacity: 0.55 },
  { top: 30, left: 100,  fontSize: 7,  opacity: 0.40 },
  { top: 46, left: 150,  fontSize: 6,  opacity: 0.32 },
  { top: 8,  left: 152,  fontSize: 6,  opacity: 0.35 },
  { top: 22, left: 196,  fontSize: 8,  opacity: 0.45 },
  { top: 40, left: 110,  fontSize: 5,  opacity: 0.30 },
  { top: 4,  left: 220,  fontSize: 6,  opacity: 0.32 },
  { bottom: 16, left: 74,  fontSize: 8, opacity: 0.45 },
  { bottom: 12, left: 128, fontSize: 6, opacity: 0.40 },
  { bottom: 28, left: 168, fontSize: 7, opacity: 0.38 },
  { bottom: 6,  left: 210, fontSize: 5, opacity: 0.30 },
  { top: 14, right: 28,  fontSize: 9,  opacity: 0.50 },
  { top: 36, right: 64,  fontSize: 6,  opacity: 0.34 },
  { top: 10, right: 92,  fontSize: 7,  opacity: 0.40 },
  { top: 28, right: 124, fontSize: 6,  opacity: 0.34 },
  { bottom: 14, right: 50,  fontSize: 11, opacity: 0.50 },
  { bottom: 30, right: 22,  fontSize: 7,  opacity: 0.40 },
  { bottom: 36, right: 110, fontSize: 5,  opacity: 0.30 },
  { bottom: 8,  right: 156, fontSize: 6,  opacity: 0.34 },
];

// Shown outside delivery hours. Browsing is still allowed, so instead of a flat
// warning strip this is a calm "good night" card: a night-sky gradient, a moon,
// a few stars, and a warm "Opens 8 AM" pill — friendly enough that the user
// happily comes back tomorrow.
export default function ClosedBanner() {
  const t = useT();

  return (
    <View style={styles.outer}>
      <FauxGradient from={NIGHT_FROM} to={NIGHT_TO} style={styles.card} steps={18}>
        {/* Decorative starfield — purely cosmetic, never intercepts touches. */}
        <Starfield stars={STARS} />

        {/* Moon badge */}
        <View style={styles.iconWrap}>
          <Ionicons name="moon" size={24} color="#FFD27D" />
        </View>

        {/* Copy */}
        <View style={styles.copy}>
          <Text weight="bold" color="#FFFFFF" style={styles.title}>
            {t('home.closedTitle')}
          </Text>
          <Text weight="regular" color="rgba(255,255,255,0.82)" style={styles.sub}>
            {t('home.closedSub')}
          </Text>

          <View style={styles.pill}>
            <Ionicons name="sunny" size={13} color="#FFC75A" />
            <Text weight="semibold" color="#FFE3A3" style={styles.pillText}>
              {t('home.closedReopen')}
            </Text>
          </View>
        </View>
      </FauxGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    marginHorizontal: Spacing.lg,
    marginBottom:     Spacing.xs,
  },
  card: {
    borderRadius:   18,
    padding:        18,
    flexDirection:  'row',
    alignItems:     'flex-start',
    gap:            14,
    ...Shadow.md,
  },
  iconWrap: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1, borderColor: 'rgba(255,210,125,0.35)',
    justifyContent: 'center', alignItems: 'center',
  },
  copy: { flex: 1 },
  title: { fontSize: 18, lineHeight: 24 },
  sub:   { fontSize: 14, lineHeight: 20, marginTop: 4 },
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 12,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1, borderColor: 'rgba(255,199,90,0.45)',
  },
  pillText: { fontSize: 13, lineHeight: 17 },
});
