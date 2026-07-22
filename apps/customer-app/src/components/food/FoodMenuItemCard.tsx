import React, { useMemo } from 'react';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FoodMenuItem } from '@chirawa/types';
import { useT } from '@chirawa/i18n';
import { Text } from '../ui';
import { Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { useFoodCart } from '../../context/FoodCartContext';
import { FOOD_ACCENT, FOOD_ACCENT_SOFT, FOOD_NONVEG, FOOD_VEG } from '../../screens/food/foodTheme';

// ─── Menu item card (Food.md §8.2) ────────────────────────────────────────────
// 2-column grid card for the Food two-pane screen. Bound to FoodCartContext
// (NOT the marketplace cart/ProductCard — those stay untouched). Simple items
// only at launch: name, price, image, optional description + veg mark.

export default function FoodMenuItemCard({
  item, width,
}: { item: FoodMenuItem; width: number }) {
  const t = useT();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors, width), [Colors, width]);
  const { quantities, addItem, setQuantity } = useFoodCart();

  const qty    = quantities[item.id] ?? 0;
  const inCart = qty > 0;
  const rupees = Math.round(item.pricePaise / 100);
  const vegColor = item.isVeg === false ? FOOD_NONVEG : FOOD_VEG;

  return (
    <View style={styles.card}>
      {/* Image / placeholder */}
      <View style={styles.imageArea}>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderEmoji}>🍽️</Text>
          </View>
        )}
        {item.isVeg != null && (
          <View style={[styles.vegBox, { borderColor: vegColor }]}>
            <View style={[styles.vegDot, { backgroundColor: vegColor }]} />
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text weight="semibold" color={Colors.textPrimary} numberOfLines={2} style={styles.name}>
          {item.name}
        </Text>
        {item.description ? (
          <Text weight="regular" color={Colors.textSecondary} numberOfLines={1} style={styles.desc}>
            {item.description}
          </Text>
        ) : null}

        <View style={styles.bottomRow}>
          <Text weight="bold" color={Colors.textPrimary} style={styles.price}>₹{rupees}</Text>

          {inCart ? (
            <View style={styles.stepper}>
              <TouchableOpacity
                onPress={() => void setQuantity(item.id, qty - 1)}
                style={styles.stepBtn}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 4 }}
                accessibilityLabel={`Remove one ${item.name}`}
              >
                <Ionicons name="remove" size={15} color={Colors.white} />
              </TouchableOpacity>
              <Text weight="bold" color={Colors.white} style={styles.stepCount}>{qty}</Text>
              <TouchableOpacity
                onPress={() => void setQuantity(item.id, qty + 1)}
                style={styles.stepBtn}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 6 }}
                accessibilityLabel={`Add one more ${item.name}`}
              >
                <Ionicons name="add" size={15} color={Colors.white} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => void addItem(item.id)}
              style={styles.addBtn}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`Add ${item.name}`}
            >
              <Text weight="bold" color={FOOD_ACCENT} style={styles.addText}>{t('food.add')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const makeStyles = (Colors: ColorPalette, width: number) =>
  StyleSheet.create({
    card: {
      width,
      backgroundColor: Colors.surface,
      borderRadius: Radius.lg,
      overflow: 'hidden',
      ...Shadow.xs,
    },
    imageArea: { height: 96, backgroundColor: FOOD_ACCENT_SOFT },
    image: { width: '100%', height: '100%' },
    placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    placeholderEmoji: { fontSize: 34, lineHeight: 40 },
    vegBox: {
      position: 'absolute', top: 6, left: 6,
      width: 14, height: 14, borderWidth: 1.5, borderRadius: 3,
      backgroundColor: Colors.surface,
      alignItems: 'center', justifyContent: 'center',
    },
    vegDot: { width: 7, height: 7, borderRadius: 4 },
    body: { padding: 8, gap: 2 },
    name: { fontSize: 12, lineHeight: 16, minHeight: 32 },
    desc: { fontSize: 10, lineHeight: 13 },
    bottomRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginTop: 6,
    },
    price: { fontSize: 14, lineHeight: 18 },
    addBtn: {
      minWidth: 64, height: 30,
      borderRadius: Radius.md, borderWidth: 1.5, borderColor: FOOD_ACCENT,
      backgroundColor: FOOD_ACCENT_SOFT,
      alignItems: 'center', justifyContent: 'center',
      paddingHorizontal: 8,
    },
    addText: { fontSize: 12, lineHeight: 15 },
    stepper: {
      flexDirection: 'row', alignItems: 'center',
      height: 30, borderRadius: Radius.md,
      backgroundColor: FOOD_ACCENT,
      paddingHorizontal: 4,
    },
    stepBtn: { paddingHorizontal: 6, height: '100%', justifyContent: 'center' },
    stepCount: { fontSize: 13, minWidth: 18, textAlign: 'center' },
  });
