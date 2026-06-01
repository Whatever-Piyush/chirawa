import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Image, TouchableOpacity, StyleSheet, Animated, Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../ui';
import { Radius, Shadow } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { useCart } from '../../context/CartContext';
import { useFlyToCart } from '../cart/FlyToCart';
import type { RootStackParamList } from '../../navigation/AppNavigator';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// 2-column grid card width: screen minus 16-px page padding each side minus
// the 12-px inter-column gap, halved.
export const PRODUCT_CARD_WIDTH = (SCREEN_WIDTH - 32 - 12) / 2;

export interface ProductCardData {
  productId:   string;
  name:        string;
  pricePaise:  number;
  mrpPaise?:   number | null;
  weightLabel?: string | null;   // "250 g"
  imageUrl?:   string | null;
  imageColor?: string;           // placeholder fill until real images land
  isNonVeg?:   boolean;
  hasVariants?: boolean;         // multi-variant products open the PDP to choose a size
}

const ADD_W      = 72;
const STEPPER_W  = 104;

export default function ProductCard({ product }: { product: ProductCardData }) {
  const { quantities, addItem, setQuantity } = useCart();
  const fly = useFlyToCart();
  const imageRef = useRef<View>(null);
  const qty = quantities[product.productId] ?? 0;
  const inCart = qty > 0;
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [imgError, setImgError] = useState(false);

  // Morph the ADD button into a stepper: animate width + crossfade contents.
  const morph = useRef(new Animated.Value(inCart ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(morph, {
      toValue: inCart ? 1 : 0,
      duration: 150,
      useNativeDriver: false,   // width can't use native driver
    }).start();
  }, [inCart, morph]);

  const width = morph.interpolate({ inputRange: [0, 1], outputRange: [ADD_W, STEPPER_W] });

  const vegColor = product.isNonVeg ? '#B71C1C' : '#1A7A2A';
  const rupees   = Math.round(product.pricePaise / 100);
  const hasMrp   = product.mrpPaise != null && product.mrpPaise > product.pricePaise;

  const onAdd = () => {
    // Multi-variant products must pick a size on the PDP — don't quick-add base price.
    if (product.hasVariants) {
      navigation.navigate('ProductDetail', { productId: product.productId });
      return;
    }
    // Fly a copy of the product image to the cart capsule, then add.
    imageRef.current?.measureInWindow((x, y, w, h) => {
      fly.trigger({ x: x + w / 2, y: y + h / 2, color: product.imageColor ?? '#FFE0CC' });
    });
    void addItem(product);
  };
  const onInc = () => { void setQuantity(product.productId, qty + 1); };
  const onDec = () => { void setQuantity(product.productId, qty - 1); };

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.9}
      onPress={() => navigation.navigate('ProductDetail', { productId: product.productId })}
    >
      {/* veg / non-veg indicator */}
      <View style={[styles.veg, { borderColor: vegColor }]}>
        <View style={[styles.vegDot, { backgroundColor: vegColor }]} />
      </View>

      {/* image area */}
      <View ref={imageRef} collapsable={false} style={styles.imageArea}>
        {product.imageUrl && !imgError ? (
          <Image
            source={{ uri: product.imageUrl }}
            style={styles.image}
            resizeMode="contain"
            onError={() => setImgError(true)}
          />
        ) : (
          <View style={[styles.placeholder, { backgroundColor: product.imageColor ?? '#FFF0E9' }]} />
        )}
      </View>

      {/* weight + ADD / stepper */}
      <View style={styles.midRow}>
        <Text weight="regular" color={Colors.textSecondary} style={styles.weight} numberOfLines={1}>
          {product.weightLabel ?? ' '}
        </Text>

        <Animated.View style={[styles.addWrap, { width }, inCart && styles.addWrapActive]}>
          {inCart ? (
            <View style={styles.stepper}>
              <TouchableOpacity onPress={onDec} style={styles.stepBtn} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
                <Ionicons name="remove" size={16} color={Colors.white} />
              </TouchableOpacity>
              <Text weight="bold" color={Colors.white} style={styles.stepCount}>{qty}</Text>
              <TouchableOpacity onPress={onInc} style={styles.stepBtn} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
                <Ionicons name="add" size={16} color={Colors.white} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={onAdd} style={styles.addBtn} activeOpacity={0.8}>
              <Text weight="bold" color={Colors.primary} style={styles.addText}>ADD</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </View>

      {/* price */}
      <View style={styles.priceRow}>
        <Text weight="bold" color={Colors.textPrimary} style={styles.price}>₹{rupees}</Text>
        {hasMrp && (
          <Text weight="regular" style={styles.mrp}>₹{Math.round((product.mrpPaise ?? 0) / 100)}</Text>
        )}
      </View>

      {/* name */}
      <Text weight="medium" color={Colors.textPrimary} numberOfLines={2} style={styles.name}>
        {product.name}
      </Text>
    </TouchableOpacity>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
  card: {
    width:           PRODUCT_CARD_WIDTH,
    backgroundColor: Colors.surface,
    borderRadius:    14,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         10,
    ...Shadow.sm,
  },
  veg: {
    position: 'absolute', top: 8, left: 8, zIndex: 2,
    width: 14, height: 14, borderRadius: 2, borderWidth: 1.5,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center', alignItems: 'center',
  },
  vegDot: { width: 8, height: 8, borderRadius: 4 },

  imageArea: {
    height: 120,
    borderRadius: 12,
    backgroundColor: '#F8F8F8',
    overflow: 'hidden',
    justifyContent: 'center', alignItems: 'center',
  },
  image:       { width: '100%', height: '100%' },
  placeholder: { width: '70%', height: '70%', borderRadius: Radius.md },

  midRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    minHeight: 32,
  },
  weight: { flex: 1, fontSize: 12, marginRight: 6 },

  addWrap: {
    height: 32,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  addWrapActive: { backgroundColor: Colors.primary },
  addBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
  },
  addText: { fontSize: 14, letterSpacing: 0.5 },

  stepper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  stepBtn:   { width: 24, alignItems: 'center', justifyContent: 'center' },
  stepCount: { fontSize: 14, minWidth: 18, textAlign: 'center' },

  priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 8 },
  price:    { fontSize: 16, lineHeight: 20 },
  mrp:      { fontSize: 12, color: '#999', textDecorationLine: 'line-through' },

  name: { fontSize: 13, lineHeight: 17, marginTop: 4 },
});
