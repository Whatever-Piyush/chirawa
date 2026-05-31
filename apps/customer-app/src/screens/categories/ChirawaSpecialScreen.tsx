import React, { useMemo } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@chirawa/i18n';
import { Text } from '../../components/ui';
import { Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import ChirawaSpecialSection from '../home/ChirawaSpecialSection';

// "Special" tab — the full Chirawa's Special surface. For now it reuses the
// ChirawaSpecialSection carousel from Chunk 7; it can grow into a richer,
// vertically-scrolling vendor directory as real shops are onboarded.
export default function ChirawaSpecialScreen() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Text weight="bold" color={Colors.white} style={styles.title}>
          {t('home.specialTitle')}
        </Text>
        <Text weight="regular" color={Colors.white} style={styles.subtitle}>
          {t('home.specialSubtitle')}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <ChirawaSpecialSection />
        <View style={{ height: Spacing.huge }} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    // Deep-red header for the signature surface (matches the section accent).
    backgroundColor:   Colors.specialAccent,
    paddingHorizontal: Spacing.lg,
    paddingBottom:     Spacing.lg,
  },
  title:    { fontSize: 22, lineHeight: 28 },
  subtitle: { fontSize: 13, lineHeight: 18, opacity: 0.9, marginTop: 2 },
  scroll:   { paddingBottom: Spacing.xxxl },
});
