import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Dimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '@chirawa/i18n';
import { Text } from '../../components/ui';
import { Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { useCart, cartKey } from '../../context/CartContext';
import ProductCard, { type ProductCardData } from '../../components/product/ProductCard';
import BrandedLoader from '../../components/BrandedLoader';
import {
  fetchProductDetail, fetchProducts, toProductCard,
  type ApiProductDetail,
} from '../../services/catalog';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { FEATURES } from '../../config/features';

type Props = NativeStackScreenProps<RootStackParamList, 'ProductDetail'>;

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GALLERY_HEIGHT = 320;

export default function ProductDetailScreen({ navigation, route }: Props) {
  const { productId } = route.params;
  const t = useT();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const { quantities, addItem, setQuantity } = useCart();

  const [detail, setDetail] = useState<ApiProductDetail | null>(null);
  const [alsoLike, setAlsoLike] = useState<ProductCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeImg, setActiveImg] = useState(0);
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    setActiveImg(0);
    fetchProductDetail(productId)
      .then((d) => {
        if (!active) return;
        setDetail(d);
        setSelectedVariantId(d.variants[0]?.id);
      })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });

    // Secondary "you might also like" rail — real products across shops.
    fetchProducts({ limit: 6 })
      .then((p) => { if (active) setAlsoLike(p.map(toProductCard)); })
      .catch(() => { /* tolerate — section hides */ });

    return () => { active = false; };
  }, [productId]);

  if (loading) {
    return <BrandedLoader />;
  }

  if (error || !detail) {
    return (
      <View style={[styles.container, styles.center, { padding: Spacing.xl }]}>
        <Text style={styles.emptyEmoji}>😕</Text>
        <Text weight="bold" color={Colors.textPrimary} style={styles.emptyTitle}>
          {t('product.notFound')}
        </Text>
        <TouchableOpacity style={styles.backCta} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Text weight="bold" color={Colors.white}>{t('common.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const gallery = detail.images.length > 0
    ? detail.images
    : (detail.imageUrl ? [detail.imageUrl] : []);

  // Highlight chips — derived from real fields now; richer attributes land in Phase 3.
  const highlights = [
    ...(detail.unit ? [{ label: t('product.netQty'), value: detail.unit }] : []),
    ...(detail.attributes ?? []),
  ];

  const selectedVariant = detail.variants.find((v) => v.id === selectedVariantId);
  const effPrice = selectedVariant ? selectedVariant.pricePaise : detail.pricePaise;
  const effMrp = selectedVariant ? selectedVariant.mrpPaise : detail.mrpPaise;
  const effInStock = selectedVariant ? selectedVariant.inStock : detail.inStock;

  const rupees = Math.round(effPrice / 100);
  const hasMrp = effMrp != null && effMrp > effPrice;
  const mrpRupees = hasMrp ? Math.round((effMrp ?? 0) / 100) : 0;
  const offPct = hasMrp ? Math.round((1 - effPrice / (effMrp ?? 1)) * 100) : 0;

  const lineKey = cartKey(detail.id, selectedVariantId);
  const qty = quantities[lineKey] ?? 0;
  const addInput = {
    productId: detail.id,
    variantId: selectedVariantId,
    name: detail.name,
    imageUrl: detail.imageUrl,
  };

  const onGalleryScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setActiveImg(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH));
  };

  return (
    <View style={styles.container}>
      {/* Floating back button over the gallery */}
      <TouchableOpacity
        style={[styles.backBtn, { top: insets.top + Spacing.sm }]}
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="arrow-back" size={22} color="#111827" />
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Image gallery carousel ─────────────────────────────────────── */}
        <View style={styles.galleryWrap}>
          {gallery.length > 0 ? (
            <ScrollView
              horizontal
              pagingEnabled
              scrollEnabled={gallery.length > 1}
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onGalleryScroll}
            >
              {gallery.map((uri, i) => (
                <View key={`${uri}-${i}`} style={styles.galleryPage}>
                  <Image source={{ uri }} style={styles.galleryImg} resizeMode="contain" />
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.placeholderLetter}>{detail.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}

          {/* Dots + counter */}
          {gallery.length > 1 && (
            <>
              <View style={styles.dotsRow} pointerEvents="none">
                {gallery.map((_, i) => (
                  <View key={i} style={[styles.dot, i === activeImg && styles.dotActive]} />
                ))}
              </View>
              <View style={styles.counter} pointerEvents="none">
                <Text weight="semibold" color={Colors.white} style={styles.counterText}>
                  {activeImg + 1}/{gallery.length}
                </Text>
              </View>
            </>
          )}
        </View>

        <View style={styles.body}>
          {/* Availability */}
          <View style={[styles.badge, effInStock ? styles.badgeIn : styles.badgeOut]}>
            <Text weight="bold" color={effInStock ? Colors.success : Colors.error} style={styles.badgeText}>
              {effInStock ? t('product.inStock') : t('product.outOfStock')}
            </Text>
          </View>

          {/* Name + unit */}
          <Text weight="bold" color={Colors.textPrimary} style={styles.name}>{detail.name}</Text>
          {detail.unit ? (
            <Text weight="medium" color={Colors.textSecondary} style={styles.unit}>{detail.unit}</Text>
          ) : null}

          {/* Highlight chips (Net Qty, Shelf Life, Flavour, Type…) */}
          {highlights.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsRow}
            >
              {highlights.map((h, i) => (
                <View key={`${h.label}-${i}`} style={styles.chip}>
                  <Text weight="regular" color={Colors.textTertiary} style={styles.chipLabel}>{h.label}</Text>
                  <Text weight="semibold" color={Colors.textPrimary} style={styles.chipValue} numberOfLines={1}>
                    {h.value}
                  </Text>
                </View>
              ))}
            </ScrollView>
          )}

          {/* Pack-size variants */}
          {detail.variants.length > 0 && (
            <View style={styles.variantRow}>
              {detail.variants.map((v) => {
                const sel = v.id === selectedVariantId;
                return (
                  <TouchableOpacity
                    key={v.id}
                    disabled={!v.inStock}
                    activeOpacity={0.8}
                    onPress={() => setSelectedVariantId(v.id)}
                    style={[styles.variantChip, sel && styles.variantChipSel, !v.inStock && styles.variantChipOut]}
                  >
                    <Text
                      weight={sel ? 'bold' : 'medium'}
                      color={sel ? Colors.primary : Colors.textSecondary}
                      style={styles.variantChipText}
                    >
                      {v.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Price */}
          <View style={styles.priceRow}>
            <Text weight="bold" color={Colors.textPrimary} style={styles.price}>₹{rupees}</Text>
            {hasMrp && (
              <>
                <Text weight="regular" color={Colors.textTertiary} style={styles.mrp}>₹{mrpRupees}</Text>
                <View style={styles.offPill}>
                  <Text weight="bold" color={Colors.success} style={styles.offText}>{offPct}% OFF</Text>
                </View>
              </>
            )}
          </View>

          {/* Sold by → shop. Hidden for v1: we present one unified Chirawa
              storefront, so we don't route users into a per-shop "store page". */}
          {FEATURES.shopBrowsing && (
            <TouchableOpacity
              style={styles.shopRow}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('ShopDetail', { shopId: detail.shopId, shopName: detail.shopName })}
            >
              <Ionicons name="storefront-outline" size={20} color={Colors.primary} />
              <View style={{ flex: 1 }}>
                <Text weight="bold" color={Colors.textPrimary} style={styles.shopName}>{detail.shopName}</Text>
                <Text weight="regular" color={Colors.textSecondary} style={styles.shopSub}>{t('product.exploreShop')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
            </TouchableOpacity>
          )}

          {/* Replacement info */}
          <View style={styles.infoRow}>
            <Ionicons name="sync-outline" size={20} color={Colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text weight="semibold" color={Colors.textPrimary} style={styles.infoTitle}>{t('product.replacementTitle')}</Text>
              <Text weight="regular" color={Colors.textSecondary} style={styles.infoSub}>{t('product.replacementSub')}</Text>
            </View>
          </View>

          {/* Description */}
          {detail.description ? (
            <View style={styles.section}>
              <Text weight="semibold" color={Colors.textPrimary} style={styles.sectionTitle}>{t('product.about')}</Text>
              <Text weight="regular" color={Colors.textSecondary} style={styles.description}>{detail.description}</Text>
            </View>
          ) : null}

          {/* Similar products — same shop */}
          {detail.related.length > 0 && (
            <View style={styles.section}>
              <Text weight="semibold" color={Colors.textPrimary} style={styles.sectionTitle}>{t('product.similar')}</Text>
              <View style={styles.grid}>
                {detail.related.map((r) => (
                  <ProductCard key={r.id} product={toProductCard(r)} size="compact" />
                ))}
              </View>
            </View>
          )}

          {/* You might also like — across shops */}
          {alsoLike.length > 0 && (
            <View style={styles.section}>
              <Text weight="semibold" color={Colors.textPrimary} style={styles.sectionTitle}>{t('product.frequentlyBought')}</Text>
              <View style={styles.grid}>
                {alsoLike.map((p) => (
                  <ProductCard key={p.productId} product={p} size="compact" />
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sticky add-to-cart */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
        {!effInStock ? (
          <View style={[styles.addBtn, styles.addBtnDisabled]}>
            <Text weight="bold" color={Colors.white} style={styles.addBtnText}>{t('product.outOfStock')}</Text>
          </View>
        ) : qty > 0 ? (
          <View style={styles.stepper}>
            <TouchableOpacity style={styles.stepBtn} onPress={() => void setQuantity(detail.id, qty - 1, selectedVariantId)} activeOpacity={0.8}>
              <Ionicons name="remove" size={22} color={Colors.white} />
            </TouchableOpacity>
            <Text weight="bold" color={Colors.white} style={styles.stepQty}>{qty}</Text>
            <TouchableOpacity style={styles.stepBtn} onPress={() => void setQuantity(detail.id, qty + 1, selectedVariantId)} activeOpacity={0.8}>
              <Ionicons name="add" size={22} color={Colors.white} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.addBtn} onPress={() => void addItem(addInput)} activeOpacity={0.85}>
            <Ionicons name="cart-outline" size={20} color={Colors.white} />
            <Text weight="bold" color={Colors.white} style={styles.addBtnText}>{t('product.addToCart')} · ₹{rupees}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    center: { justifyContent: 'center', alignItems: 'center' },
    emptyEmoji: { fontSize: 48, lineHeight: 64, marginBottom: 8 },
    emptyTitle: { fontSize: 18, marginBottom: Spacing.lg, textAlign: 'center' },
    backCta: { backgroundColor: Colors.primary, paddingHorizontal: Spacing.xl, paddingVertical: 12, borderRadius: 14 },

    backBtn: {
      position: 'absolute', left: Spacing.lg, zIndex: 10,
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: 'rgba(255,255,255,0.92)',
      justifyContent: 'center', alignItems: 'center',
      ...Shadow.sm,
    },

    // Gallery
    galleryWrap: { width: '100%', height: GALLERY_HEIGHT, backgroundColor: Colors.surface },
    galleryPage: { width: SCREEN_WIDTH, height: GALLERY_HEIGHT, justifyContent: 'center', alignItems: 'center' },
    galleryImg: { width: '82%', height: '82%' },
    imagePlaceholder: {
      flex: 1, justifyContent: 'center', alignItems: 'center',
    },
    placeholderLetter: { fontSize: 56, fontFamily: 'Poppins_700Bold', color: Colors.primary },
    dotsRow: {
      position: 'absolute', bottom: 12, left: 0, right: 0,
      flexDirection: 'row', justifyContent: 'center', gap: 5,
    },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.2)' },
    dotActive: { width: 16, backgroundColor: Colors.primary },
    counter: {
      position: 'absolute', top: 16, right: 16,
      backgroundColor: 'rgba(0,0,0,0.45)',
      paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999,
    },
    counterText: { fontSize: 12 },

    body: { padding: Spacing.lg },
    badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, marginBottom: Spacing.sm },
    badgeIn: { backgroundColor: Colors.successLight },
    badgeOut: { backgroundColor: Colors.errorLight },
    badgeText: { fontSize: 11, letterSpacing: 0.3 },

    name: { fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
    unit: { fontSize: 14, marginTop: 2 },

    // Highlight chips
    chipsRow: { gap: Spacing.sm, paddingVertical: Spacing.md, paddingRight: Spacing.lg },
    chip: {
      minWidth: 96,
      backgroundColor: Colors.surface,
      borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
      paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
      gap: 2,
    },
    chipLabel: { fontSize: 11 },
    chipValue: { fontSize: 13 },

    variantRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: Spacing.sm },
    variantChip: {
      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
      borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface,
    },
    variantChipSel: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
    variantChipOut: { opacity: 0.4 },
    variantChipText: { fontSize: 14 },

    priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: Spacing.md },
    price: { fontSize: 26 },
    mrp: { fontSize: 16, textDecorationLine: 'line-through' },
    offPill: { backgroundColor: Colors.successLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
    offText: { fontSize: 12 },

    shopRow: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
      marginTop: Spacing.lg, padding: Spacing.md,
      backgroundColor: Colors.surface, borderRadius: Radius.lg,
      borderWidth: 1, borderColor: Colors.border,
    },
    shopName: { fontSize: 15 },
    shopSub: { fontSize: 12, marginTop: 1 },

    infoRow: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
      marginTop: Spacing.md, padding: Spacing.md,
      backgroundColor: Colors.surface, borderRadius: Radius.lg,
      borderWidth: 1, borderColor: Colors.border,
    },
    infoTitle: { fontSize: 14 },
    infoSub: { fontSize: 12, marginTop: 1 },

    section: { marginTop: Spacing.xl },
    sectionTitle: { fontSize: 17, marginBottom: Spacing.md },
    description: { fontSize: 14, lineHeight: 21 },

    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },

    footer: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.divider,
      paddingHorizontal: Spacing.lg, paddingTop: Spacing.md,
    },
    addBtn: {
      flexDirection: 'row', gap: 8, backgroundColor: Colors.primary,
      height: 54, borderRadius: 16, justifyContent: 'center', alignItems: 'center',
    },
    addBtnDisabled: { backgroundColor: Colors.disabled },
    addBtnText: { fontSize: 16, letterSpacing: 0.3 },
    stepper: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: Colors.primary, height: 54, borderRadius: 16, paddingHorizontal: Spacing.lg,
    },
    stepBtn: { width: 44, height: 54, justifyContent: 'center', alignItems: 'center' },
    stepQty: { fontSize: 20, minWidth: 40, textAlign: 'center' },
  });
