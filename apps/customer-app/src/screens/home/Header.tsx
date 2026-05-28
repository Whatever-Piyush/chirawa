import React, { useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Animated, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/ui';
import { Colors, Spacing } from '../../theme';

// Tagline copy is brand-voice Hinglish — keep here, not in i18n, so designers
// can tune the rotation without touching translations.
const TAGLINES = [
  'Chirawa ka apna bazar 🛺',
  'Taza, seedha, jaldi 🌿',
  'Ghar tak pahuncha do ✨',
] as const;

const ROTATE_MS = 3000;   // dwell time per tagline
const FADE_MS   = 150;    // out + in
const HEADER_BLEED = 28;  // bottom padding so the SearchBar can overlap upward

interface Props {
  onProfilePress: () => void;
  style?: ViewStyle;
  /** Optional entrance opacity Animated.Value the parent screen drives */
  entranceOpacity?: Animated.Value;
}

export default function Header({ onProfilePress, style, entranceOpacity }: Props) {
  const insets = useSafeAreaInsets();
  const [tagIndex, setTagIndex] = useState(0);
  const tagOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const id = setInterval(() => {
      Animated.timing(tagOpacity, {
        toValue: 0, duration: FADE_MS, useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        setTagIndex((i) => (i + 1) % TAGLINES.length);
        Animated.timing(tagOpacity, {
          toValue: 1, duration: FADE_MS, useNativeDriver: true,
        }).start();
      });
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [tagOpacity]);

  return (
    <Animated.View
      style={[
        styles.header,
        { paddingTop: insets.top + Spacing.md },
        entranceOpacity ? { opacity: entranceOpacity } : null,
        style,
      ]}
    >
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text
            color={Colors.white}
            weight="bold"
            style={styles.brand}
          >
            Bringly
          </Text>
          <Animated.Text
            style={[styles.tagline, { opacity: tagOpacity }]}
            numberOfLines={1}
          >
            {TAGLINES[tagIndex]}
          </Animated.Text>
        </View>

        <TouchableOpacity
          onPress={onProfilePress}
          activeOpacity={0.85}
          style={styles.profileBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Profile"
        >
          <Ionicons name="person-circle-outline" size={26} color={Colors.white} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor:   Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingBottom:     HEADER_BLEED,
  },
  row: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.md,
  },
  brand: {
    // Spec calls for 22 / Poppins Bold — `weight="bold"` on Text already
    // resolves to Poppins_700Bold via poppinsFamily().
    fontSize:   22,
    lineHeight: 28,
  },
  tagline: {
    fontSize:   12,
    lineHeight: 16,
    marginTop:  2,
    color:      'rgba(255,255,255,0.85)',
    // Match the Poppins family the rest of <Text> uses so it doesn't visually
    // pop next to the Bringly title.
    fontFamily: 'Poppins_400Regular',
  },
  profileBtn: {
    width:           38,
    height:          38,
    borderRadius:    19,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent:  'center',
    alignItems:      'center',
  },
});
