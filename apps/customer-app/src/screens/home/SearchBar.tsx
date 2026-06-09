import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '@chirawa/i18n';
import { useToast } from '../../components/ui';
import { Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';

const ROTATE_MS  = 1500;   // how long each placeholder dwells
const FADE_OUT   = 100;
const FADE_IN    = 200;
const SLIDE_UP   = 8;      // px the new line slides up from
const BAR_HEIGHT = 48;

interface Props {
  /** Fires when the user taps the bar — typically navigates to Search. */
  onPress: () => void;
  /** Optional entrance animation values driven by the parent screen. */
  entranceOpacity?:   Animated.Value;
  entranceTranslate?: Animated.Value;
}

export default function SearchBar({
  onPress,
  entranceOpacity,
  entranceTranslate,
}: Props) {
  const t        = useT();
  const toast    = useToast();
  const { colors: Colors } = useTheme();
  const [index, setIndex] = useState(0);
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  // Memoise the placeholder list — only rebuilds on locale change.
  const placeholders = useMemo(
    () => [
      t('home.searchRotate1'),
      t('home.searchRotate2'),
      t('home.searchRotate3'),
      t('home.searchRotate4'),
      t('home.searchRotate5'),
    ],
    [t],
  );

  const opacity    = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const id = setInterval(() => {
      // Quick fade-out of the current placeholder, then swap text and slide
      // the new one in from below (translateY 8 → 0, opacity 0 → 1, 200ms
      // ease-out — matches spec §2).
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0, duration: FADE_OUT, useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: -SLIDE_UP, duration: FADE_OUT, useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (!finished) return;
        setIndex((i) => (i + 1) % placeholders.length);
        translateY.setValue(SLIDE_UP);
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: FADE_IN,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: 0,
            duration: FADE_IN,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start();
      });
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [opacity, translateY, placeholders.length]);

  return (
    <Animated.View
      style={[
        styles.outer,
        entranceOpacity   ? { opacity: entranceOpacity } : null,
        entranceTranslate ? { transform: [{ translateY: entranceTranslate }] } : null,
      ]}
    >
      <TouchableOpacity
        style={styles.bar}
        activeOpacity={0.85}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Search"
      >
        <Ionicons
          name="search"
          size={20}
          color={Colors.textSecondary}
          style={styles.leftIcon}
        />

        {/* "Search for" stays fixed; only the quoted item name rotates. The clip
            keeps the translateY slide from bleeding above/below the bar. */}
        <View style={styles.placeholderRow}>
          <Text style={styles.placeholder} numberOfLines={1}>
            {t('home.searchPrefix')}{' '}
          </Text>
          <View style={styles.placeholderClip}>
            <Animated.Text
              numberOfLines={1}
              style={[styles.placeholder, { opacity, transform: [{ translateY }] }]}
            >
              {`"${placeholders[index]}"`}
            </Animated.Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => toast.show(t('home.voiceSoon'), 'info')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.micWrap}
          activeOpacity={0.7}
          accessibilityLabel="Voice search"
        >
          <Ionicons name="mic-outline" size={22} color={Colors.primary} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
  outer: {
    paddingHorizontal: Spacing.lg,    // spec: 16
    paddingVertical:   10,            // spec: 10
    backgroundColor:   Colors.background,
  },
  bar: {
    flexDirection:    'row',
    alignItems:       'center',
    height:           BAR_HEIGHT,
    backgroundColor:  Colors.surface,
    borderRadius:     14,
    borderWidth:      1,
    borderColor:      Colors.border,
    paddingHorizontal: 14,
    // Subtle orange-tinted shadow per spec §2
    shadowColor:   '#FF6B35',
    shadowOpacity: 0.08,
    shadowRadius:  4,
    shadowOffset:  { width: 0, height: 2 },
    elevation:     2,
  },
  leftIcon: {
    marginRight: 10,
  },
  placeholderRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  placeholderClip: {
    flex: 1,
    height: BAR_HEIGHT - 2,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  placeholder: {
    fontSize:   14,
    color:      Colors.textSecondary,
    fontFamily: 'Poppins_400Regular',
  },
  micWrap: {
    paddingLeft: 12,
    justifyContent: 'center',
  },
});
