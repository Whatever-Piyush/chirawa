import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '@chirawa/i18n';
import { Text } from '../../components/ui';
import { Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { useCart } from '../../context/CartContext';
import ProductCard, { type ProductCardData } from '../../components/product/ProductCard';
import { fetchProductDetail, toProductCard, type ApiProductDetail } from '../../services/catalog';
import type { RootStackParamList } from '../../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'ProductDetail'>;

export default function ProductDetailScreen({ navigation, route }: Props) {
  const { productId } = route.params;
  const t = useT();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const { quantities, addItem, setQuantity } = useCart();

  const [detail, setDetail] = useState<ApiProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    fetchProductDetail(productId)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productId]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View style={[styles.container, styles.center, { padding: Spacing.xl }]}>
        <Text style={styles.emptyEmoji}>😕</Text>
        <Text weight="bold" color={Colors.textPrimary} style={styles.emptyTitle}>
          {t('product.notFound')}
        </Text>
        <TouchableOpacity style={styles.backCta} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Text weight="bold" color={Colors.white}>
            {t('common.back')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const rupees = Math.round(detail.pricePaise / 100);
  const hasMrp = detail.mrpPaise != null && detail.mrpPaise > detail.pricePaise;
  const mrpRupees = hasMrp ? Math.round((detail.mrpPaise ?? 0) / 100) : 0;

  const qty = quantities[detail.id] ?? 0;
  const cartProduct: ProductCardData = {
    productId: detail.id,
    name: detail.name,
    pricePaise: detail.pricePaise,
    mrpPaise: detail.mrpPaise,
    weightLabel: detail.unit,
    imageUrl: detail.imageUrl,
  };

  return (
    <View style={styles.container}>
      {/* Floating back button over the image */}
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
        {/* Image */}
        <View style={styles.imageWrap}>
          {detail.imageUrl && !imgError ? (
            <Image
              source={{ uri: detail.imageUrl }}
              style={styles.image}
              resizeMode="contain"
              onError={() => setImgError(true)}
            />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.placeholderLetter}>{detail.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
        </View>

        <View style={styles.body}>
          {/* Availability */}
          <View style={[styles.badge, detail.inStock ? styles.badgeIn : styles.badgeOut]}>
            <Text weight="bold" color={detail.inStock ? Colors.success : Colors.error} style={styles.badgeText}>
              {detail.inStock ? t('product.inStock') : t('product.outOfStock')}
            </Text>
          </View>

          {/* Name + unit */}
          <Text weight="bold" color={Colors.textPrimary} style={styles.name}>
            {detail.name}
          </Text>
          {detail.unit ? (
            <Text weight="medium" color={Colors.textSecondary} style={styles.unit}>
              {detail.unit}
            </Text>
          ) : null}

          {/* Price */}
          <View style={styles.priceRow}>
            <Text weight="bold" color={Colors.textPrimary} style={styles.price}>
              ₹{rupees}
            </Text>
            {hasMrp && (
              <Text weight="regular" color={Colors.textTertiary} style={styles.mrp}>
                ₹{mrpRupees}
              </Text>
            )}
          </View>

          {/* Sold by → shop */}
          <TouchableOpacity
            style={styles.shopRow}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('ShopDetail', { shopId: detail.shopId, shopName: detail.shopName })}
          >
            <Ionicons name="storefront-outline" size={18} color={Colors.primary} />
            <Text weight="medium" color={Colors.textSecondary} style={styles.shopText}>
              {t('product.soldBy')} <Text weight="bold" color={Colors.primary}>{detail.shopName}</Text>
            </Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
          </TouchableOpacity>

          {/* Description */}
          {detail.description ? (
            <View style={styles.section}>
              <Text weight="semibold" color={Colors.textPrimary} style={styles.sectionTitle}>
                {t('product.about')}
              </Text>
              <Text weight="regular" color={Colors.textSecondary} style={styles.description}>
                {detail.description}
              </Text>
            </View>
          ) : null}

          {/* Frequently bought together */}
          {detail.related.length > 0 && (
            <View style={styles.section}>
              <Text weight="semibold" color={Colors.textPrimary} style={styles.sectionTitle}>
                {t('product.frequentlyBought')}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.relatedRow}>
                {detail.related.map((r) => (
                  <View key={r.id} style={styles.relatedCard}>
                    <ProductCard product={toProductCard(r)} />
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sticky add-to-cart */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
        {!detail.inStock ? (
          <View style={[styles.addBtn, styles.addBtnDisabled]}>
            <Text weight="bold" color={Colors.white} style={styles.addBtnText}>
              {t('product.outOfStock')}
            </Text>
          </View>
        ) : qty > 0 ? (
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => void setQuantity(detail.id, qty - 1)}
              activeOpacity={0.8}
            >
              <Ionicons name="remove" size={22} color={Colors.white} />
            </TouchableOpacity>
            <Text weight="bold" color={Colors.white} style={styles.stepQty}>
              {qty}
            </Text>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => void setQuantity(detail.id, qty + 1)}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={22} color={Colors.white} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.addBtn} onPress={() => void addItem(cartProduct)} activeOpacity={0.85}>
            <Ionicons name="cart-outline" size={20} color={Colors.white} />
            <Text weight="bold" color={Colors.white} style={styles.addBtnText}>
              {t('product.addToCart')} · ₹{rupees}
            </Text>
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
    backCta: {
      backgroundColor: Colors.primary,
      paddingHorizontal: Spacing.xl,
      paddingVertical: 12,
      borderRadius: 14,
    },

    backBtn: {
      position: 'absolute',
      left: Spacing.lg,
      zIndex: 10,
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: 'rgba(255,255,255,0.9)',
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.1,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },

    imageWrap: {
      width: '100%',
      height: 320,
      backgroundColor: Colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
    },
    image: { width: '85%', height: '85%' },
    imagePlaceholder: {
      width: 140,
      height: 140,
      borderRadius: 24,
      backgroundColor: Colors.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    placeholderLetter: { fontSize: 56, fontFamily: 'Poppins_700Bold', color: Colors.primary },

    body: { padding: Spacing.lg },
    badge: {
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 999,
      marginBottom: Spacing.sm,
    },
    badgeIn: { backgroundColor: Colors.successLight },
    badgeOut: { backgroundColor: Colors.errorLight },
    badgeText: { fontSize: 11, letterSpacing: 0.3 },

    name: { fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
    unit: { fontSize: 14, marginTop: 2 },
    priceRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: Spacing.sm },
    price: { fontSize: 24 },
    mrp: { fontSize: 16, textDecorationLine: 'line-through' },

    shopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: Spacing.lg,
      paddingVertical: Spacing.md,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: Colors.divider,
    },
    shopText: { flex: 1, fontSize: 14 },

    section: { marginTop: Spacing.xl },
    sectionTitle: { fontSize: 16, marginBottom: Spacing.sm },
    description: { fontSize: 14, lineHeight: 21 },

    relatedRow: { gap: 12, paddingVertical: 4 },
    relatedCard: { width: 160 },

    footer: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: Colors.surface,
      borderTopWidth: 1,
      borderTopColor: Colors.divider,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
    },
    addBtn: {
      flexDirection: 'row',
      gap: 8,
      backgroundColor: Colors.primary,
      height: 54,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
    },
    addBtnDisabled: { backgroundColor: Colors.disabled },
    addBtnText: { fontSize: 16, letterSpacing: 0.3 },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: Colors.primary,
      height: 54,
      borderRadius: 16,
      paddingHorizontal: Spacing.lg,
    },
    stepBtn: { width: 44, height: 54, justifyContent: 'center', alignItems: 'center' },
    stepQty: { fontSize: 20, minWidth: 40, textAlign: 'center' },
  });
