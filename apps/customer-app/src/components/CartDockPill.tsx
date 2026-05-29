import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '@chirawa/i18n';
import { Text } from './ui';
import { Colors, Spacing } from '../theme';
import { useCart } from '../context/CartContext';
import type { RootStackParamList } from '../navigation/AppNavigator';

const TAB_BAR_BASE = 64;   // matches CustomTabBar height (excl. safe-area)
const GAP_ABOVE_BAR = 8;

// Floating cart capsule (v2 §Feature 4A) — deep navy pill that hovers above
// the bottom nav whenever the cart has items. Slides up on first add, slides
// down when emptied, and "bumps" on count change. Shows the last-added
// product thumbnail. Reads the server-backed CartContext.
export default function CartDockPill() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { count, subtotalPaise, lastAddedItem } = useCart();

  const anim  = useRef(new Animated.Value(count > 0 ? 1 : 0)).current; // 0 hidden → 1 shown
  const scale = useRef(new Animated.Value(1)).current;                 // count-change bump
  const prevCount = useRef(count);
  const [rendered, setRendered] = useState(count > 0);

  useEffect(() => {
    const prev = prevCount.current;
    prevCount.current = count;

    if (count > 0) {
      if (!rendered) setRendered(true);
      Animated.spring(anim, {
        toValue: 1, tension: 200, friction: 18, useNativeDriver: true,
      }).start();
      // bump when the count changes while already visible
      if (prev > 0 && prev !== count) {
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.04, duration: 60, useNativeDriver: true }),
          Animated.spring(scale, { toValue: 1, tension: 300, friction: 10, useNativeDriver: true }),
        ]).start();
      }
    } else if (rendered) {
      Animated.parallel([
        Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(({ finished }) => { if (finished) setRendered(false); });
    }
  }, [count, rendered, anim, scale]);

  if (!rendered) return null;

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [90, 0] });
  const rupees     = Math.round(subtotalPaise / 100);
  const itemsWord  = count === 1 ? t('cart.itemOne') : t('cart.itemMany');

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          bottom:    insets.bottom + TAB_BAR_BASE + GAP_ABOVE_BAR,
          opacity:   anim,
          transform: [{ translateY }, { scale }],
        },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        style={styles.pill}
        onPress={() => navigation.navigate('Cart')}
        accessibilityRole="button"
        accessibilityLabel={t('cart.viewCart')}
      >
        {/* Left — last-added product thumbnail with count badge */}
        <View style={styles.thumb}>
          {lastAddedItem?.imageUrl ? (
            <Image source={{ uri: lastAddedItem.imageUrl }} style={styles.thumbImg} resizeMode="cover" />
          ) : (
            <View style={[styles.thumbImg, { backgroundColor: lastAddedItem?.imageColor ?? '#2A2A3E' }]} />
          )}
          {count > 1 && (
            <View style={styles.countDot}>
              <Text weight="bold" color={Colors.white} style={styles.countDotText}>{count}</Text>
            </View>
          )}
        </View>

        {/* Center — view cart + summary */}
        <View style={styles.center}>
          <Text weight="semibold" color={Colors.white} style={styles.title}>
            {t('cart.viewCart')}
          </Text>
          <Text weight="regular" style={styles.summary}>
            {count} {itemsWord}  ·  ₹{rupees}
          </Text>
        </View>

        {/* Right — arrow */}
        <View style={styles.arrow}>
          <Ionicons name="arrow-forward" size={20} color={Colors.white} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left:     Spacing.lg,
    right:    Spacing.lg,
  },
  pill: {
    flexDirection:   'row',
    alignItems:      'center',
    height:          56,
    borderRadius:    28,
    backgroundColor: '#1A1A2E',   // deep navy — premium dark contrast (spec)
    paddingHorizontal: 8,
    // heavy float shadow
    shadowColor:   '#000',
    shadowOpacity: 0.18,
    shadowRadius:  12,
    shadowOffset:  { width: 0, height: 4 },
    elevation:     12,
  },
  thumb: {
    width: 40, height: 40,
  },
  thumbImg: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: '#2A2A3E',
  },
  countDot: {
    position: 'absolute', top: -4, right: -4,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 3,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1.5, borderColor: '#1A1A2E',
  },
  countDotText: { fontSize: 9, lineHeight: 11 },
  center: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  title:   { fontSize: 15, lineHeight: 19 },
  summary: { fontSize: 12, lineHeight: 16, color: 'rgba(255,255,255,0.65)', marginTop: 1 },
  arrow: {
    width: 40, alignItems: 'center', justifyContent: 'center', paddingRight: 8,
  },
});
