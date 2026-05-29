import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '@chirawa/i18n';
import { Text } from './ui';
import { Colors, Radius, Shadow, Spacing } from '../theme';
import { useCart } from '../context/CartContext';
import type { RootStackParamList } from '../navigation/AppNavigator';

const TAB_BAR_BASE = 60;   // matches CustomTabBar height (excl. safe-area)
const GAP_ABOVE_BAR = 10;

// Floating "View cart" pill — hovers above the bottom tab bar on the main
// tab surfaces. Appears (slide + fade up) when the cart has items and
// unmounts when empty. Tapping opens the Cart screen.
export default function CartDockPill() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { count, subtotalPaise } = useCart();

  const anim = useRef(new Animated.Value(0)).current; // 0 hidden → 1 shown
  const visible = count > 0;

  useEffect(() => {
    Animated.spring(anim, {
      toValue:         visible ? 1 : 0,
      friction:        7,
      tension:         120,
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  // Fully unmount when hidden so it never intercepts touches near the tab bar.
  if (!visible) return null;

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [90, 0] });
  const rupees     = Math.round(subtotalPaise / 100);
  const itemsWord  = count === 1 ? t('cart.itemOne') : t('cart.itemMany');

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { bottom: insets.bottom + TAB_BAR_BASE + GAP_ABOVE_BAR, opacity: anim, transform: [{ translateY }] },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        style={styles.pill}
        onPress={() => navigation.navigate('Cart')}
        accessibilityRole="button"
        accessibilityLabel={t('cart.viewCart')}
      >
        <View style={styles.iconWrap}>
          <Ionicons name="cart" size={22} color={Colors.white} />
        </View>

        <View style={styles.middle}>
          <Text color={Colors.white} style={styles.countLine}>
            {count} {itemsWord}
          </Text>
          <Text weight="bold" color={Colors.white} style={styles.totalLine}>
            ₹{rupees}
          </Text>
        </View>

        <View style={styles.cta}>
          <Text weight="bold" color={Colors.white} style={styles.ctaText}>
            {t('cart.viewCart')}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.white} />
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
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   Colors.primary,
    borderRadius:      Radius.lg,
    height:            58,
    paddingHorizontal: Spacing.lg,
    ...Shadow.primary,
  },
  iconWrap: {
    width:           34,
    height:          34,
    borderRadius:    17,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent:  'center',
    alignItems:      'center',
  },
  middle: {
    flex:       1,
    marginLeft: Spacing.md,
  },
  countLine: {
    fontSize:   12,
    lineHeight: 15,
    opacity:    0.9,
  },
  totalLine: {
    fontSize:   16,
    lineHeight: 20,
  },
  cta: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           2,
  },
  ctaText: {
    fontSize:   15,
    lineHeight: 19,
  },
});
