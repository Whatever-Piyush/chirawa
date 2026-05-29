import React from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '@chirawa/i18n';
import { Text, FauxGradient } from '../../components/ui';
import { Colors, Spacing, Shadow } from '../../theme';

interface Props {
  /** Optional entrance animation values driven by the parent screen. */
  entranceOpacity?:   Animated.Value;
  entranceTranslate?: Animated.Value;
}

// Full-width promo card per the redesign brief. We deliberately avoid a
// money-off message (Bringly can't honour discounts yet) — instead the
// banner reinforces the *delivery promise* + freshness, both things we
// actually deliver every order. FauxGradient avoids the expo-linear-gradient
// native dep; 20 steps reads smooth enough on a static hero card.
export default function FeaturedBanner({
  entranceOpacity,
  entranceTranslate,
}: Props) {
  const t = useT();

  return (
    <Animated.View
      style={[
        styles.outer,
        entranceOpacity   ? { opacity: entranceOpacity } : null,
        entranceTranslate ? { transform: [{ translateY: entranceTranslate }] } : null,
      ]}
    >
      <FauxGradient
        from="#FF6B35"   // brand orange
        to="#FF9A5C"     // softer orange
        style={styles.card}
        steps={20}
      >
        {/* Left column — copy */}
        <View style={styles.copy}>
          <Text
            weight="semibold"
            color={Colors.white}
            style={styles.title}
          >
            {t('home.bannerTitle')}
          </Text>
          <Text
            weight="regular"
            color={Colors.white}
            style={styles.sub}
          >
            {t('home.bannerSub')}
          </Text>
        </View>

        {/* Right column — decorative clock icon. Absolute so it never
            elbows the copy column; 25% opacity keeps it subtle. Clock
            (time-outline) reinforces the "30 minutes" promise visually. */}
        <View pointerEvents="none" style={styles.decorWrap}>
          <Ionicons name="time-outline" size={48} color="rgba(255,255,255,0.25)" />
        </View>
      </FauxGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  outer: {
    marginTop:         Spacing.lg,
    marginHorizontal:  Spacing.lg,
  },
  card: {
    minHeight:         80,
    borderRadius:      14,
    paddingVertical:   16,
    paddingHorizontal: 18,
    overflow:          'hidden',
    flexDirection:     'row',
    alignItems:        'center',
    ...Shadow.md,
  },
  copy: {
    flex:         1,
    paddingRight: 56,   // reserve space under the absolute clock icon
  },
  title: {
    fontSize:   14,
    lineHeight: 20,
  },
  sub: {
    fontSize:   12,
    lineHeight: 16,
    marginTop:  4,
    opacity:    0.8,
  },
  decorWrap: {
    position: 'absolute',
    right:    18,
    top:      0,
    bottom:   0,
    justifyContent: 'center',
  },
});
