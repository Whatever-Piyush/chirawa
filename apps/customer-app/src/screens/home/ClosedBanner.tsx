import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '@chirawa/i18n';
import { Text, FauxGradient } from '../../components/ui';
import { Spacing, Shadow } from '../../theme';
import { NIGHT_FROM, NIGHT_TO } from './nightTheme';

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
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Text style={[styles.star, { top: 12, left: 54, fontSize: 10, opacity: 0.55 }]}>✦</Text>
          <Text style={[styles.star, { top: 30, left: 96, fontSize: 7,  opacity: 0.4 }]}>✦</Text>
          <Text style={[styles.star, { bottom: 16, left: 70, fontSize: 8, opacity: 0.45 }]}>✧</Text>
          <Text style={[styles.star, { top: 16, right: 26, fontSize: 9,  opacity: 0.5 }]}>✧</Text>
          <Text style={[styles.star, { bottom: 14, right: 54, fontSize: 11, opacity: 0.5 }]}>✦</Text>
        </View>

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
  star: { position: 'absolute', color: '#FFFFFF' },
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
