import React, { useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Animated, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/ui';
import { Colors, Spacing } from '../../theme';
import { useAuth } from '../../context/AuthContext';

// Taglines updated for maximum psychological impact and speed
const TAGLINES = [
  'Chirawa ka apna bazar 🛍️',
  'Need it now? Bringly it. ⚡',
  'The Best of Chirawa, at Your Fingertips. ✨',
] as const;

const ROTATE_MS = 3000; // dwell time per tagline
const FADE_MS = 150; // out + in
const HEADER_BLEED = 28; // bottom padding so the SearchBar can overlap upward

interface Props {
  onProfilePress: () => void;
  style?: ViewStyle;
  entranceOpacity?: Animated.Value;
}

export default function Header({ onProfilePress, style, entranceOpacity }: Props) {
  const insets = useSafeAreaInsets();
  const { state } = useAuth();
  const [tagIndex, setTagIndex] = useState(0);
  const tagOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const id = setInterval(() => {
      Animated.timing(tagOpacity, {
        toValue: 0,
        duration: FADE_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        setTagIndex((i) => (i + 1) % TAGLINES.length);
        Animated.timing(tagOpacity, {
          toValue: 1,
          duration: FADE_MS,
          useNativeDriver: true,
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
          <Text color={Colors.white} weight="bold" style={styles.brand}>
            Bringly
          </Text>
          <Animated.Text style={[styles.tagline, { opacity: tagOpacity }]} numberOfLines={1}>
            {TAGLINES[tagIndex]}
          </Animated.Text>
        </View>

        <TouchableOpacity
          onPress={onProfilePress}
          activeOpacity={0.7}
          style={styles.profileBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Profile"
        >
          {/* 🔴 Dynamic Typographic Avatar applied here */}
          <Text style={styles.avatarText}>
            {state.name ? state.name.charAt(0).toUpperCase() : '?'}
          </Text>

          {/* Premium "Live/Active" Notification Dot */}
          <View style={styles.activeDot} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingBottom: HEADER_BLEED,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  brand: {
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 12.5,
    lineHeight: 16,
    marginTop: 2,
    color: 'rgba(255,255,255,0.75)',
    fontFamily: 'Poppins_400Regular',
    letterSpacing: 0.2,
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
});
