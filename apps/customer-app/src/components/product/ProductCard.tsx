import React, { useMemo, useRef, useState } from 'react';
import {
  View, Image, TouchableOpacity, StyleSheet, Dimensions, ScrollView,
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
// 3-column dense grid (Home feed): 16px page padding each side + 2×10px gaps.
export const PRODUCT_CARD_WIDTH_DENSE   = (SCREEN_WIDTH - 32 - 20) / 3;

export type ProductCardSize = 'regular' | 'compact' | 'dense';

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

// Per-size layout dimensions. The ADD button and the −/+ stepper share ONE width
// (addW) — the control morphs in place and never grows, so it can't cover the
// pack-size / qty label next to it (Blinkit/Zepto keep the stepper compact too).
const DIMS: Record<ProductCardSize, {
  width: number; imageHeight: number; addW: number;
  nameSize: number; priceSize: number; pad: number;
}> = {
  regular: { width: PRODUCT_CARD_WIDTH,         imageHeight: 120, addW: 78, nameSize: 13, priceSize: 16, pad: 10 },
  compact: { width: PRODUCT_CARD_WIDTH_COMPACT, imageHeight: 88,  addW: 58, nameSize: 11, priceSize: 13, pad: 7 },
  dense:   { width: PRODUCT_CARD_WIDTH_DENSE,   imageHeight: 104, addW: 64, nameSize: 12, priceSize: 15, pad: 8 },
};

function ProductCard({
  product, size = 'regular', showEta = false, cardWidth,
}: { product: ProductCardData; size?: ProductCardSize; showEta?: boolean; cardWidth?: number }) {
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

  const vegColor = product.isNonVeg ? '#B71C1C' : '#1A7A2A';
  const rupees   = Math.round(product.pricePaise / 100);
  const hasMrp   = product.mrpPaise != null && product.mrpPaise > product.pricePaise;
  // % off MRP for the dense card's discount ribbon — computed, never fabricated.
  const offPct   = hasMrp && product.mrpPaise
    ? Math.round(((product.mrpPaise - product.pricePaise) / product.mrpPaise) * 100)
    : null;

  // Cart writes are always allowed — even when the store is closed (night hours).
  // The shopper can build their cart anytime; the backend gates only the order
  // itself (Checkout's Place Order stays disabled until opening), and the cart
  // persists server-side, so in the morning they just check out without re-adding.
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

  // ── Dense (Blinkit-geometry) variant — Home feed grid + For You swiper ────
  // The ADD button floats over the image's bottom-right corner; pack-size, price
  // /MRP/OFF and the title flow as their own lines below (so nothing overlaps the
  // button). Real fields only (no fabricated ratings / "N options" / favourite).
  if (size === 'dense') {
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.9}
        onPress={() => navigation.navigate('ProductDetail', { productId: product.productId })}
      >
        <View ref={imageRef} collapsable={false} style={styles.denseImageArea}>
          <View style={styles.denseImageClip}>
            {images.length > 0 ? (
              <Image source={{ uri: images[0] }} style={styles.denseImage} resizeMode="contain" />
            ) : (
              <View style={[styles.placeholder, { backgroundColor: product.imageColor ?? '#FFF0E9' }]} />
            )}
          </View>

          {/* veg indicator (defaults to veg — real flag is a backend follow-up) */}
          <View style={[styles.denseVeg, { borderColor: vegColor }]}>
            <View style={[styles.vegDot, { backgroundColor: vegColor }]} />
          </View>

          {/* ADD ↔ stepper — overlaps the image's bottom-right corner */}
          <View style={[styles.denseAddWrap, inCart && styles.addWrapActive]}>
            {inCart ? (
              <View style={styles.stepper}>
                <TouchableOpacity onPress={onDec} style={styles.stepBtn} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
                  <Ionicons name="remove" size={14} color={Colors.white} />
                </TouchableOpacity>
                <Text weight="bold" color={Colors.white} style={styles.stepCount}>{qty}</Text>
                <TouchableOpacity onPress={onInc} style={styles.stepBtn} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
                  <Ionicons name="add" size={14} color={Colors.white} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={onAdd} style={styles.addBtn} activeOpacity={0.8}>
                <Text weight="bold" color={Colors.primary} style={styles.denseAddText}>ADD</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* pack size — its own line below the image (Blinkit/Zepto style), so it
            never sits under the floating ADD button */}
        {product.weightLabel ? (
          <Text weight="regular" color={Colors.textSecondary} numberOfLines={1} style={styles.densePack}>
            {product.weightLabel}
          </Text>
        ) : null}

        {/* price + strikethrough MRP */}
        <View style={styles.densePriceRow}>
          <Text weight="bold" color={Colors.textPrimary} style={styles.densePrice}>₹{rupees}</Text>
          {hasMrp && (
            <Text weight="regular" color={Colors.textTertiary} style={styles.denseMrp}>
              ₹{Math.round((product.mrpPaise ?? 0) / 100)}
            </Text>
          )}
        </View>

        {/* maroon discount ribbon — only when there's a genuine discount */}
        {offPct != null && (
          <View style={styles.denseRibbon}>
            <Text weight="bold" color={Colors.white} style={styles.denseRibbonText}>{offPct}% OFF</Text>
          </View>
        )}

        {/* title */}
        <Text weight="medium" color={Colors.textPrimary} numberOfLines={2} style={styles.denseName}>
          {product.name}
        </Text>

        {/* optional delivery-ETA chip (global ETA, not per-product) */}
        {showEta && (
          <View style={styles.denseEtaRow}>
            <Ionicons name="time-outline" size={11} color={Colors.textTertiary} />
            <Text weight="medium" color={Colors.textTertiary} style={styles.denseEta}>10 mins</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

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

        <View style={[styles.addWrap, inCart && styles.addWrapActive]}>
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
        </View>
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

// Memoised so a cart tick re-renders only the touched card in the dense grid.
export default React.memo(ProductCard);

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
    width: dims.addW,
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

  // Fluid −/+ : the count takes the middle (flex:1) and the buttons hug the edges,
  // so the stepper fits inside addW at every size and the count is never clipped.
  stepper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  stepBtn:   { paddingHorizontal: 3, paddingVertical: 4, alignItems: 'center', justifyContent: 'center' },
  stepCount: { flex: 1, fontSize: dims.nameSize + 1, textAlign: 'center' },

  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  pricePill: { backgroundColor: '#1F8E3D', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 },
  priceText: { fontSize: dims.priceSize - 3, lineHeight: dims.priceSize + 1 },
  mrp:      { fontSize: dims.nameSize, color: '#999', textDecorationLine: 'line-through' },
  off:      { fontSize: dims.nameSize - 1, color: '#1F8E3D', marginTop: 2 },

  name: { fontSize: dims.nameSize, lineHeight: dims.nameSize + 4, marginTop: 3 },

  // ── Dense (Blinkit-geometry) card — Chirawa-skinned ──────────────────────
  // marginBottom reserves the strip the floating ADD button overhangs into, so
  // the pack-size + price lines below it can never collide with the button.
  denseImageArea: { height: dims.imageHeight, marginBottom: 14, overflow: 'visible' },
  denseImageClip: {
    height: dims.imageHeight, borderRadius: 12, backgroundColor: '#F8F8F8',
    overflow: 'hidden', justifyContent: 'center', alignItems: 'center',
  },
  denseImage: { width: '80%', height: '80%' },
  denseVeg: {
    position: 'absolute', top: 6, right: 6,
    width: 14, height: 14, borderRadius: 2, borderWidth: 1.5,
    backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center',
  },
  densePack: { fontSize: 11, lineHeight: 14, marginTop: 4 },
  denseAddWrap: {
    position: 'absolute', right: 6, bottom: -14, width: dims.addW, height: 30,
    borderRadius: 16, borderWidth: 1.5, borderColor: Colors.primary,
    backgroundColor: Colors.surface, overflow: 'hidden', justifyContent: 'center',
    ...Shadow.sm,
  },
  denseAddText: { fontSize: 12, letterSpacing: 0.5 },
  densePriceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  densePrice: { fontSize: dims.priceSize, lineHeight: dims.priceSize + 3 },
  denseMrp: { fontSize: 11, textDecorationLine: 'line-through' },
  denseRibbon: {
    alignSelf: 'flex-start', backgroundColor: Colors.specialAccent,
    borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, marginTop: 3,
  },
  denseRibbonText: { fontSize: 9, lineHeight: 13, letterSpacing: 0.2 },
  denseName: { fontSize: dims.nameSize, lineHeight: dims.nameSize + 4, marginTop: 4 },
  denseEtaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  denseEta: { fontSize: 10, lineHeight: 13 },
});
