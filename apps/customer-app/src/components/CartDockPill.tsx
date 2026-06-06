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
const GAP_ABOVE_BAR = 10;

// Floating cart capsule — Blinkit-style content-hugging pill, centered above
// the bottom nav. Brand orange (matches the header / banner) with a left
// product thumbnail, "View cart" + summary, and a circular chevron.
export default function CartDockPill() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { count, subtotalPaise, lastAddedItem } = useCart();

  const anim  = useRef(new Animated.Value(count > 0 ? 1 : 0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const prevCount = useRef(count);
  const [rendered, setRendered] = useState(count > 0);

  useEffect(() => {
    const prev = prevCount.current;
    prevCount.current = count;

    if (count > 0) {
      if (!rendered) setRendered(true);
      Animated.spring(anim, { toValue: 1, tension: 200, friction: 18, useNativeDriver: true }).start();
      if (prev > 0 && prev !== count) {
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.05, duration: 60, useNativeDriver: true }),
          Animated.spring(scale, { toValue: 1, tension: 300, friction: 10, useNativeDriver: true }),
        ]).start();
      }
    } else if (rendered) {
      Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true })
        .start(({ finished }) => { if (finished) setRendered(false); });
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
        { bottom: insets.bottom + TAB_BAR_BASE + GAP_ABOVE_BAR, opacity: anim, transform: [{ translateY }, { scale }] },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        style={styles.pill}
        onPress={() => navigation.navigate('Checkout')}
        accessibilityRole="button"
        accessibilityLabel={t('cart.viewCart')}
      >
        {/* Left — last-added product thumbnail */}
        <View style={styles.thumb}>
          {lastAddedItem?.imageUrl ? (
            <Image source={{ uri: lastAddedItem.imageUrl }} style={styles.thumbImg} resizeMode="cover" />
          ) : (
            <View style={[styles.thumbImg, { backgroundColor: lastAddedItem?.imageColor ?? 'rgba(255,255,255,0.25)' }]} />
          )}
        </View>

        {/* Center — view cart + summary */}
        <View style={styles.center}>
          <Text weight="bold" color={Colors.white} style={styles.title}>
            {t('cart.viewCart')}
          </Text>
          <Text weight="medium" style={styles.summary}>
            {count} {itemsWord}  ·  ₹{rupees}
          </Text>
        </View>

        {/* Right — circular chevron */}
        <View style={styles.chevron}>
          <Ionicons name="chevron-forward" size={18} color={Colors.primary} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position:   'absolute',
    left:       Spacing.lg,
    right:      Spacing.lg,
    alignItems: 'center',     // centre the content-hugging pill
  },
  pill: {
    flexDirection:   'row',
    alignItems:      'center',
    alignSelf:       'center',
    minWidth:        190,              // shorter, content-hugging
    height:          48,
    borderRadius:    24,
    backgroundColor: Colors.primary,   // brand orange — matches header/banner
    paddingLeft:     6,
    paddingRight:    6,
    shadowColor:   Colors.primary,
    shadowOpacity: 0.40,
    shadowRadius:  12,
    shadowOffset:  { width: 0, height: 5 },
    elevation:     12,
  },
  thumb: { width: 34, height: 34 },
  thumbImg: {
    width: 34, height: 34, borderRadius: 10,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)',
  },
  center: { flex: 1, marginLeft: Spacing.sm, marginRight: Spacing.sm },
  title:   { fontSize: 14, lineHeight: 18 },
  summary: { fontSize: 11, lineHeight: 14, color: 'rgba(255,255,255,0.9)', marginTop: 1 },
  chevron: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: Colors.white,
    justifyContent: 'center', alignItems: 'center',
  },
});
