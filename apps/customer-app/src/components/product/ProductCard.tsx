import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Image, TouchableOpacity, StyleSheet, Animated, Dimensions, ScrollView,
  type NativeSyntheticEvent, type NativeScrollEvent,
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

// 2-column grid card (regular) and 3-column (compact, smaller tiles).
export const PRODUCT_CARD_WIDTH         = (SCREEN_WIDTH - 32 - 12) / 2;
export const PRODUCT_CARD_WIDTH_COMPACT = (SCREEN_WIDTH - 32 - 24) / 3;

export type ProductCardSize = 'regular' | 'compact';

export interface ProductCardData {
  productId:   string;
  name:        string;
  pricePaise:  number;
  mrpPaise?:   number | null;
  weightLabel?: string | null;   // "250 g"
  imageUrl?:   string | null;
  images?:     string[];         // full set for the swipeable carousel
  imageColor?: string;           // placeholder fill until real images land
  isNonVeg?:   boolean;
  hasVariants?: boolean;         // multi-variant products open the PDP to choose a size
}

// Per-size layout dimensions.
const DIMS: Record<ProductCardSize, {
  width: number; imageHeight: number; addW: number; stepperW: number;
  nameSize: number; priceSize: number; pad: number;
}> = {
  regular: { width: PRODUCT_CARD_WIDTH,         imageHeight: 120, addW: 72, stepperW: 104, nameSize: 13, priceSize: 16, pad: 10 },
  compact: { width: PRODUCT_CARD_WIDTH_COMPACT, imageHeight: 88,  addW: 54, stepperW: 80,  nameSize: 11, priceSize: 13, pad: 7 },
};

export default function ProductCard({
  product, size = 'regular', cardWidth,
}: { product: ProductCardData; size?: ProductCardSize; cardWidth?: number }) {
  const { quantities, addItem, setQuantity } = useCart();
  const fly = useFlyToCart();
  const imageRef = useRef<View>(null);
  const qty = quantities[product.productId] ?? 0;
  const inCart = qty > 0;
  const { colors: Colors } = useTheme();
  const dims = DIMS[size];
  // Optional explicit width (e.g. the two-pane category grid renders cards in a
  // pane narrower than the full screen). Defaults to the per-size width.
  const resolvedWidth = cardWidth ?? dims.width;
  const styles = useMemo(() => makeStyles(Colors, dims, resolvedWidth), [Colors, dims, resolvedWidth]);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [activeImg, setActiveImg] = useState(0);

  // Image set for the carousel — fall back to the single imageUrl.
  const images = useMemo(() => {
    if (product.images && product.images.length > 0) return product.images;
    return product.imageUrl ? [product.imageUrl] : [];
  }, [product.images, product.imageUrl]);

  const pageWidth = resolvedWidth - dims.pad * 2;

  // Morph the ADD button into a stepper: animate width + crossfade contents.
  const morph = useRef(new Animated.Value(inCart ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(morph, {
      toValue: inCart ? 1 : 0,
      duration: 150,
      useNativeDriver: false,   // width can't use native driver
    }).start();
  }, [inCart, morph]);

  const width = morph.interpolate({ inputRange: [0, 1], outputRange: [dims.addW, dims.stepperW] });

  const vegColor = product.isNonVeg ? '#B71C1C' : '#1A7A2A';
  const rupees   = Math.round(product.pricePaise / 100);
  const hasMrp   = product.mrpPaise != null && product.mrpPaise > product.pricePaise;

  const onAdd = () => {
    // Multi-variant products must pick a size on the PDP — don't quick-add base price.
    if (product.hasVariants) {
      navigation.navigate('ProductDetail', { productId: product.productId });
      return;
    }
    imageRef.current?.measureInWindow((x, y, w, h) => {
      fly.trigger({ x: x + w / 2, y: y + h / 2, color: product.imageColor ?? '#FFE0CC' });
    });
    void addItem(product);
  };
  const onInc = () => { void setQuantity(product.productId, qty + 1); };
  const onDec = () => { void setQuantity(product.productId, qty - 1); };

  const onCarouselScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setActiveImg(Math.round(e.nativeEvent.contentOffset.x / pageWidth));
  };

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

      {/* image area — swipeable carousel + dots */}
      <View ref={imageRef} collapsable={false} style={styles.imageArea}>
        {images.length > 0 ? (
          <>
            <ScrollView
              horizontal
              pagingEnabled
              scrollEnabled={images.length > 1}
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onCarouselScroll}
            >
              {images.map((uri, i) => (
                <Image
                  key={`${uri}-${i}`}
                  source={{ uri }}
                  style={{ width: pageWidth, height: dims.imageHeight }}
                  resizeMode="contain"
                />
              ))}
            </ScrollView>

            {images.length > 1 && (
              <View style={styles.dotsRow} pointerEvents="none">
                {images.map((_, i) => (
                  <View key={i} style={[styles.dot, i === activeImg && styles.dotActive]} />
                ))}
              </View>
            )}
          </>
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
                <Ionicons name="remove" size={size === 'compact' ? 13 : 16} color={Colors.white} />
              </TouchableOpacity>
              <Text weight="bold" color={Colors.white} style={styles.stepCount}>{qty}</Text>
              <TouchableOpacity onPress={onInc} style={styles.stepBtn} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
                <Ionicons name="add" size={size === 'compact' ? 13 : 16} color={Colors.white} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={onAdd} style={styles.addBtn} activeOpacity={0.8}>
              <Text weight="bold" color={Colors.primary} style={styles.addText}>ADD</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </View>

      {/* price — green badge + strikethrough MRP + savings */}
      <View style={styles.priceRow}>
        <View style={styles.pricePill}>
          <Text weight="bold" color="#FFFFFF" style={styles.priceText}>₹{rupees}</Text>
        </View>
        {hasMrp && (
          <Text weight="regular" style={styles.mrp}>₹{Math.round((product.mrpPaise ?? 0) / 100)}</Text>
        )}
      </View>
      {hasMrp && (
        <Text weight="semibold" style={styles.off}>
          ₹{Math.round(((product.mrpPaise ?? 0) - product.pricePaise) / 100)} OFF
        </Text>
      )}

      {/* name */}
      <Text weight="medium" color={Colors.textPrimary} numberOfLines={2} style={styles.name}>
        {product.name}
      </Text>
    </TouchableOpacity>
  );
}

const makeStyles = (Colors: ColorPalette, dims: typeof DIMS[ProductCardSize], cardWidth: number) =>
  StyleSheet.create({
  card: {
    width:           cardWidth,
    backgroundColor: Colors.surface,
    borderRadius:    14,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         dims.pad,
    ...Shadow.sm,
  },
  veg: {
    position: 'absolute', top: 8, left: 8, zIndex: 3,
    width: 14, height: 14, borderRadius: 2, borderWidth: 1.5,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center', alignItems: 'center',
  },
  vegDot: { width: 8, height: 8, borderRadius: 4 },

  imageArea: {
    height: dims.imageHeight,
    borderRadius: 12,
    backgroundColor: '#F8F8F8',
    overflow: 'hidden',
    justifyContent: 'center', alignItems: 'center',
  },
  placeholder: { width: '70%', height: '70%', borderRadius: Radius.md },

  // Carousel dots
  dotsRow: {
    position: 'absolute', bottom: 6, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 4,
  },
  dot: {
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  dotActive: {
    width: 7,
    backgroundColor: Colors.primary,
  },

  midRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    minHeight: 30,
  },
  weight: { flex: 1, fontSize: dims.nameSize, marginRight: 4 },

  addWrap: {
    height: 30,
    borderRadius: 18,
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
  addText: { fontSize: dims.nameSize + 1, letterSpacing: 0.5 },

  stepper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
  },
  stepBtn:   { width: 22, alignItems: 'center', justifyContent: 'center' },
  stepCount: { fontSize: dims.nameSize + 1, minWidth: 16, textAlign: 'center' },

  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  pricePill: { backgroundColor: '#1F8E3D', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 },
  priceText: { fontSize: dims.priceSize - 3, lineHeight: dims.priceSize + 1 },
  mrp:      { fontSize: dims.nameSize, color: '#999', textDecorationLine: 'line-through' },
  off:      { fontSize: dims.nameSize - 1, color: '#1F8E3D', marginTop: 2 },

  name: { fontSize: dims.nameSize, lineHeight: dims.nameSize + 4, marginTop: 3 },
});
