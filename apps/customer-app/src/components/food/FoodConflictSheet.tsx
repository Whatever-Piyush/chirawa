import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '@chirawa/i18n';
import { Text } from '../ui';
import { Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { useFoodCart } from '../../context/FoodCartContext';
import { FOOD_ACCENT, FOOD_ACCENT_SOFT } from '../../screens/food/foodTheme';

// ─── Premium food-cart confirmation sheet (Food.md §4.5) ──────────────────────
// Renders the FoodCartContext's `conflict` state. Never a raw toast, never a
// system dialog. Two variants:
//   different-restaurant → [Start New Order] (explicit clear) / [Continue Current Order]
//   cross-info           → informational Grocery→Food education / [Got it]
// Mount once near the navigator root (inside FoodCartProvider).

export default function FoodConflictSheet() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const { conflict, cart, startNewOrder, dismissConflict } = useFoodCart();

  const visible = conflict != null;
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      slide.setValue(0);
      Animated.timing(slide, {
        toValue: 1, duration: 260,
        easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start();
    }
  }, [visible, slide]);

  if (!conflict) return null;

  const isDifferentRestaurant = conflict.kind === 'different-restaurant';
  const title = isDifferentRestaurant
    ? t('food.conflictDiffRestaurantTitle')
    : t('food.conflictCrossTitle');
  const body = isDifferentRestaurant
    ? t('food.conflictDiffRestaurantBody')
    : t('food.conflictCrossBody');

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [320, 0] });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismissConflict}>
      {/* Backdrop — tap outside continues the current order (non-destructive default). */}
      <Pressable style={styles.backdrop} onPress={dismissConflict} accessibilityLabel="Close" />

      <Animated.View
        style={[
          styles.sheet,
          { paddingBottom: Math.max(insets.bottom, Spacing.lg), transform: [{ translateY }] },
        ]}
        accessibilityViewIsModal
      >
        <View style={styles.grabber} />

        <View style={styles.iconBubble}>
          <Ionicons
            name={isDifferentRestaurant ? 'restaurant-outline' : 'bicycle-outline'}
            size={26}
            color={FOOD_ACCENT}
          />
        </View>

        <Text weight="bold" color={Colors.textPrimary} align="center" style={styles.title}>
          {title}
        </Text>
        {isDifferentRestaurant && cart?.restaurantName ? (
          <View style={styles.currentPill}>
            <Ionicons name="storefront-outline" size={12} color={FOOD_ACCENT} />
            <Text weight="semibold" color={FOOD_ACCENT} style={styles.currentPillText} numberOfLines={1}>
              {t('food.fromRestaurant')}: {cart.restaurantName}
            </Text>
          </View>
        ) : null}
        <Text weight="regular" color={Colors.textSecondary} align="center" style={styles.body}>
          {body}
        </Text>

        {isDifferentRestaurant ? (
          <>
            <TouchableOpacity
              style={styles.primaryBtn}
              activeOpacity={0.85}
              onPress={() => void startNewOrder()}
              accessibilityRole="button"
              accessibilityLabel={t('food.startNewOrder')}
            >
              <Text weight="bold" color={Colors.white}>{t('food.startNewOrder')}</Text>
              <Text weight="regular" color={Colors.white} style={styles.primaryHint}>
                {t('food.startNewOrderHint')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              activeOpacity={0.85}
              onPress={dismissConflict}
              accessibilityRole="button"
              accessibilityLabel={t('food.continueOrder')}
            >
              <Text weight="semibold" color={Colors.textPrimary}>{t('food.continueOrder')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.primaryBtn}
            activeOpacity={0.85}
            onPress={dismissConflict}
            accessibilityRole="button"
            accessibilityLabel={t('food.gotIt')}
          >
            <Text weight="bold" color={Colors.white}>{t('food.gotIt')}</Text>
          </TouchableOpacity>
        )}
      </Animated.View>
    </Modal>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    sheet: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      backgroundColor: Colors.surface,
      borderTopLeftRadius: 28, borderTopRightRadius: 28,
      paddingHorizontal: Spacing.xl, paddingTop: Spacing.md,
      alignItems: 'center',
      ...Shadow.md,
    },
    grabber: {
      width: 44, height: 5, borderRadius: 3,
      backgroundColor: Colors.border, marginBottom: Spacing.lg,
    },
    iconBubble: {
      width: 60, height: 60, borderRadius: 24,
      backgroundColor: FOOD_ACCENT_SOFT,
      alignItems: 'center', justifyContent: 'center',
      marginBottom: Spacing.md,
    },
    title: { fontSize: 18, lineHeight: 24, maxWidth: 300 },
    currentPill: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 10, paddingVertical: 5,
      borderRadius: Radius.full, backgroundColor: FOOD_ACCENT_SOFT,
      marginTop: Spacing.sm, maxWidth: 280,
    },
    currentPillText: { fontSize: 11, lineHeight: 14 },
    body: {
      fontSize: 13, lineHeight: 19,
      marginTop: Spacing.sm, marginBottom: Spacing.xl, maxWidth: 320,
    },
    primaryBtn: {
      alignSelf: 'stretch', alignItems: 'center',
      backgroundColor: FOOD_ACCENT,
      borderRadius: Radius.lg, paddingVertical: Spacing.md,
    },
    primaryHint: { fontSize: 10, lineHeight: 13, opacity: 0.85, marginTop: 1 },
    secondaryBtn: {
      alignSelf: 'stretch', alignItems: 'center',
      borderRadius: Radius.lg, paddingVertical: Spacing.md,
      borderWidth: 1.5, borderColor: Colors.border,
      marginTop: Spacing.sm,
    },
  });
