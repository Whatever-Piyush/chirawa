import React from 'react';
import { View, StyleSheet, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '@chirawa/i18n';
import { Text, FauxGradient } from '../../components/ui';
import { Spacing, Shadow } from '../../theme';
import { NIGHT_FROM, NIGHT_TO } from './nightTheme';
import Starfield from './Starfield';
import Planet from './Planet';
import Moon from './Moon';

// A scattered star map (position + size + opacity + optional colour). Varied
// brightness and a few blue/violet/gold tints give a deep-space feel rather
// than a flat pattern.
const STARS: TextStyle[] = [
  { top: 10, left: 60,   fontSize: 12, opacity: 0.85 },
  { top: 30, left: 100,  fontSize: 7,  opacity: 0.40 },
  { top: 46, left: 150,  fontSize: 5,  opacity: 0.30 },
  { top: 8,  left: 152,  fontSize: 6,  opacity: 0.35, color: '#BFD0FF' },
  { top: 22, left: 196,  fontSize: 9,  opacity: 0.55 },
  { top: 40, left: 110,  fontSize: 4,  opacity: 0.28 },
  { top: 4,  left: 220,  fontSize: 6,  opacity: 0.32 },
  { top: 18, left: 256,  fontSize: 5,  opacity: 0.30, color: '#E2D2FF' },
  { top: 44, left: 250,  fontSize: 7,  opacity: 0.42 },
  { bottom: 16, left: 74,  fontSize: 8, opacity: 0.48 },
  { bottom: 12, left: 128, fontSize: 5, opacity: 0.34 },
  { bottom: 28, left: 168, fontSize: 7, opacity: 0.40, color: '#BFD0FF' },
  { bottom: 6,  left: 210, fontSize: 4, opacity: 0.28 },
  { bottom: 34, left: 96,  fontSize: 6, opacity: 0.36 },
  { top: 14, right: 28,  fontSize: 10, opacity: 0.60 },
  { top: 36, right: 64,  fontSize: 5,  opacity: 0.30 },
  { top: 10, right: 92,  fontSize: 7,  opacity: 0.42 },
  { top: 28, right: 124, fontSize: 6,  opacity: 0.34, color: '#FFF1C9' },
  { top: 48, right: 100, fontSize: 4,  opacity: 0.26 },
  { bottom: 14, right: 50,  fontSize: 12, opacity: 0.70 },
  { bottom: 30, right: 22,  fontSize: 6,  opacity: 0.38 },
  { bottom: 36, right: 110, fontSize: 5,  opacity: 0.30, color: '#E2D2FF' },
  { bottom: 8,  right: 156, fontSize: 6,  opacity: 0.34 },
  { bottom: 22, right: 88,  fontSize: 4,  opacity: 0.26 },
];

// Shown outside delivery hours. Browsing is still allowed, so instead of a flat
// warning strip this is a calm "good night" card: a night-sky gradient, a moon,
// a few stars, and an "Opens 9 AM" pill — friendly enough that the user
// happily comes back tomorrow.
export default function ClosedBanner() {
  const t = useT();

  return (
    <View style={styles.outer}>
      <FauxGradient from={NIGHT_FROM} to={NIGHT_TO} style={styles.card} steps={18}>
        {/* Decorative starfield + a planet — cosmetic, no touch capture. */}
        <Starfield stars={STARS} />
        <Planet kind="neptune" size={34} style={{ bottom: 12, right: 16, opacity: 0.85 }} />

        {/* Aesthetic glowing moon */}
        <Moon size={48} />

        {/* Copy */}
        <View style={styles.copy}>
          <Text weight="bold" color="#FFFFFF" style={styles.title}>
            {t('home.closedTitle')}
          </Text>
          <Text weight="regular" color="rgba(255,255,255,0.82)" style={styles.sub}>
            {t('home.closedSub')}
          </Text>

          <View style={styles.pill}>
            <Ionicons name="sunny" size={13} color="#000000" />
            <Text weight="bold" color="#000000" style={styles.pillText}>
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
    marginTop:    Spacing.sm,
    marginBottom: Spacing.xs,
  },
  card: {
    // Full-bleed strip — touches the screen's left & right edges, square corners.
    borderRadius:   0,
    padding:        18,
    flexDirection:  'row',
    alignItems:     'center',
    gap:            14,
    ...Shadow.md,
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
    backgroundColor: '#FFFFFF',   // white chip, black text
    ...Shadow.sm,
  },
  pillText: { fontSize: 13, lineHeight: 17 },
});
