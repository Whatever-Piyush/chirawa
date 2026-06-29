import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useT } from '@chirawa/i18n';
import { Text } from '../../components/ui';
import Shimmer from '../../components/ui/Shimmer';
import FauxGradient from '../../components/ui/FauxGradient';
import RatingBadge from '../../components/ui/RatingBadge';
import { Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { fetchShops, type ApiShop } from '../../services/catalog';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import ClosedBanner from '../home/ClosedBanner';
import NightHeaderBackground from '../home/NightHeaderBackground';
import { NIGHT_FROM } from '../home/nightTheme';
import { useStoreClosed } from '../../hooks/useStoreClosed';

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_GAP = Spacing.md;
const CARD_WIDTH = Math.floor((SCREEN_WIDTH - Spacing.lg * 2 - GRID_GAP) / 2);
const CARD_HEIGHT = 218;
const HEADER_BAND_HEIGHT = 112;

// Promised delivery time shown on every Special shop card (20 min, was 30).
const DELIVERY_ETA_MIN = 20;

type Navigation = NativeStackNavigationProp<RootStackParamList>;

const CARD_GRADIENTS = [
  ['#C4383A', '#FF6B35'],
  ['#7C2D12', '#F97316'],
  ['#9F1239', '#FB7185'],
  ['#78350F', '#F59E0B'],
  ['#164E63', '#2DD4BF'],
  ['#581C87', '#C084FC'],
] as const;

function emojiForShop(name: string): string {
  if (/mithai|misthan|sweet|halwai|ladoo|jalebi/i.test(name)) return '🍬';
  if (/saag|rotta|roti|dhaba|bhojan|thali/i.test(name)) return '🍛';
  if (/fresh|mart|sabzi|veg|fruit|organic/i.test(name)) return '🥬';
  if (/bakery|cake|bread|biscuit/i.test(name)) return '🥐';
  return '🏪';
}

function chunkShops(shops: ApiShop[]): ApiShop[][] {
  const rows: ApiShop[][] = [];
  for (let i = 0; i < shops.length; i += 2) {
    rows.push(shops.slice(i, i + 2));
  }
  return rows;
}

function shopCopy(shop: ApiShop, t: (key: string) => string): string {
  if (shop.description?.trim()) return shop.description;
  return `${DELIVERY_ETA_MIN} ${t('home.min')} delivery`;
}

interface ShopCardProps {
  shop: ApiShop;
  index: number;
  t: (key: string) => string;
  open: boolean;   // app service window (9 AM–8 PM) — same for every shop
  onPress: () => void;
}

const SpecialShopCard = React.memo(function SpecialShopCard({
  shop,
  index,
  t,
  open,
  onPress,
}: ShopCardProps) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const [from, to] = CARD_GRADIENTS[index % CARD_GRADIENTS.length];

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      style={[styles.card, { width: CARD_WIDTH }]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${shop.name}`}
    >
      <FauxGradient from={from} to={to} style={styles.cardHeader}>
        <View style={styles.heroRow}>
          <View style={styles.iconBubble}>
            <Text style={styles.heroEmoji}>{emojiForShop(shop.name)}</Text>
          </View>
          <View style={styles.statusBadge}>
            <Ionicons
              name={open ? 'time-outline' : 'moon-outline'}
              size={12}
              color={Colors.white}
            />
            <Text weight="semibold" color={Colors.white} style={styles.statusText}>
              {open ? t('home.open') : t('home.closed')}
            </Text>
          </View>
        </View>
      </FauxGradient>

      <View style={styles.cardBody}>
        <Text
          weight="semibold"
          color={Colors.textPrimary}
          numberOfLines={2}
          style={styles.shopName}
        >
          {shop.name}
        </Text>
        <Text
          weight="regular"
          color={Colors.textSecondary}
          numberOfLines={2}
          style={styles.shopCopy}
        >
          {shopCopy(shop, t)}
        </Text>

        <View style={styles.bottomRow}>
          <RatingBadge
            average={shop.rating?.average ?? null}
            count={shop.rating?.count ?? 0}
            size={12}
            showCount={false}
          />
          <Text weight="medium" color={Colors.specialAccent} style={styles.orderNow}>
            Order Now →
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
});

interface SkeletonCardProps {
  index: number;
}

function SkeletonCard({ index }: SkeletonCardProps) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const [from, to] = CARD_GRADIENTS[index % CARD_GRADIENTS.length];

  return (
    <View style={[styles.card, { width: CARD_WIDTH }]}>
      <FauxGradient from={from} to={to} style={styles.cardHeader}>
        <View style={styles.iconBubble}>
          <Shimmer width={44} height={44} borderRadius={999} />
        </View>
      </FauxGradient>
      <View style={styles.cardBody}>
        <Shimmer width="82%" height={16} />
        <View style={{ height: 6 }} />
        <Shimmer width="96%" height={13} />
        <View style={{ height: 4 }} />
        <Shimmer width="68%" height={13} />
        <View style={{ flex: 1 }} />
        <View style={styles.bottomRow}>
          <Shimmer width={58} height={22} borderRadius={Radius.full} />
          <Shimmer width={76} height={16} borderRadius={Radius.full} />
        </View>
      </View>
    </View>
  );
}

// Static, non-interactive note shown below the shops — purely informational.
function ContactBanner({ t }: { t: (key: string) => string }) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  return (
    <View style={styles.ctaCard} accessibilityRole="text">
      <View style={styles.ctaIcon}>
        <Ionicons name="storefront-outline" size={26} color={Colors.specialAccent} />
      </View>
      <View style={styles.ctaBody}>
        <Text weight="bold" color={Colors.specialAccent} numberOfLines={2}>
          {t('home.specialContactTitle')}
        </Text>
        <Text
          weight="regular"
          color={Colors.textSecondary}
          numberOfLines={3}
          style={styles.ctaCopy}
        >
          {t('home.specialContactDesc')}
        </Text>
      </View>
    </View>
  );
}

export default function ChirawaSpecialScreen() {
  const t = useT();
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const closed = useStoreClosed();

  const [shops, setShops] = useState<ApiShop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const shopRows = useMemo(() => chunkShops(shops), [shops]);

  const loadShops = useCallback(async () => {
    setError(false);
    setLoading(true);
    try {
      const allShops = await fetchShops();
      setShops(allShops.filter((shop) => shop.isFeatured));
    } catch {
      setError(true);
      setShops([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadShops();
  }, [loadShops]);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const openShop = useCallback(
    (shop: ApiShop) => {
      navigation.navigate('ShopDetail', { shopId: shop.id, shopName: shop.name });
    },
    [navigation],
  );

  const handleRetry = useCallback(() => {
    void loadShops();
  }, [loadShops]);

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + Spacing.sm },
          closed && styles.headerNight,
        ]}
      >
        {closed && <NightHeaderBackground topInset={insets.top} />}
        <View style={styles.headerContent}>
          <View style={styles.eyebrow}>
            <Text weight="semibold" color={Colors.white} style={styles.eyebrowText}>
              Local Legends
            </Text>
          </View>
          <Text weight="bold" color={Colors.white} style={styles.title}>
            {t('home.specialTitle')}
          </Text>
          <Text weight="regular" color={Colors.white} style={styles.subtitle}>
            {t('home.specialSubtitle')}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {closed && <ClosedBanner />}

        {loading ? (
          <View style={styles.grid}>
            {Array.from({ length: 12 }).map((_, index) => (
              <SkeletonCard key={`skeleton-${index}`} index={index} />
            ))}
          </View>
        ) : error ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="restaurant-outline" size={32} color={Colors.specialAccent} />
            </View>
            <Text weight="bold" color={Colors.textPrimary} style={styles.emptyTitle}>
              Could not load special shops
            </Text>
            <Text
              weight="regular"
              color={Colors.textSecondary}
              align="center"
              style={styles.emptyCopy}
            >
              Please check your connection and try again.
            </Text>
            <TouchableOpacity activeOpacity={0.88} onPress={handleRetry} style={styles.retryButton}>
              <Text weight="semibold" color={Colors.white}>
                {t('common.retry')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : shops.length > 0 ? (
          <View style={styles.grid}>
            {shopRows.map((row, rowIndex) => (
              <View key={`shop-row-${rowIndex}`} style={styles.row}>
                {row.map((shop, columnIndex) => (
                  <SpecialShopCard
                    key={shop.id}
                    shop={shop}
                    index={rowIndex * 2 + columnIndex}
                    t={t}
                    open={!closed}
                    onPress={() => openShop(shop)}
                  />
                ))}
              </View>
            ))}
            {/* Non-interactive note, below the shops */}
            <ContactBanner t={t} />
          </View>
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="storefront-outline" size={32} color={Colors.specialAccent} />
            </View>
            <Text weight="bold" color={Colors.textPrimary} style={styles.emptyTitle}>
              No special shops yet
            </Text>
            <Text
              weight="regular"
              color={Colors.textSecondary}
              align="center"
              style={styles.emptyCopy}
            >
              We’re adding Chirawa’s best local shops soon.
            </Text>
          </View>
        )}

        <View style={{ height: Spacing.huge }} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    header: {
      backgroundColor: Colors.specialAccent,
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.xl,
      overflow: 'hidden',
    },
    headerNight: {
      backgroundColor: NIGHT_FROM,
    },
    headerContent: { position: 'relative', zIndex: 1 },
    eyebrow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: Radius.full,
      backgroundColor: 'rgba(255,255,255,0.16)',
      marginBottom: Spacing.md,
    },
    eyebrowText: { fontSize: 11, lineHeight: 14, letterSpacing: 0.2 },
    title: { fontSize: 25, lineHeight: 31 },
    subtitle: { fontSize: 13, lineHeight: 18, opacity: 0.9, marginTop: 3, maxWidth: 280 },
    scroll: { paddingBottom: Spacing.xxxl },
    grid: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.lg,
      gap: Spacing.md,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: GRID_GAP,
    },
    card: {
      backgroundColor: Colors.surface,
      borderRadius: Radius.xl,
      overflow: 'hidden',
      ...Shadow.md,
    },
    cardHeader: {
      height: HEADER_BAND_HEIGHT,
      justifyContent: 'flex-end',
      padding: Spacing.sm,
    },
    heroRow: {
      position: 'relative',
      zIndex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    iconBubble: {
      width: 58,
      height: 58,
      borderRadius: 22,
      backgroundColor: 'rgba(255,255,255,0.22)',
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.28)',
    },
    heroEmoji: { fontSize: 30, lineHeight: 34 },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: Radius.full,
      backgroundColor: 'rgba(0,0,0,0.22)',
    },
    statusText: { fontSize: 10, lineHeight: 13 },
    cardBody: {
      flex: 1,
      padding: Spacing.md,
      justifyContent: 'space-between',
      minHeight: CARD_HEIGHT - HEADER_BAND_HEIGHT,
    },
    shopName: { fontSize: 14, lineHeight: 18 },
    shopCopy: { fontSize: 11, lineHeight: 15, marginTop: 5 },
    bottomRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.xs,
      marginTop: Spacing.md,
    },
    orderNow: { fontSize: 11, lineHeight: 15 },
    ctaCard: {
      minHeight: 88,
      borderRadius: Radius.xl,
      backgroundColor: Colors.special,
      borderWidth: 1,
      borderColor: Colors.specialBorder,
      flexDirection: 'row',
      alignItems: 'center',
      padding: Spacing.md,
      gap: Spacing.md,
      ...Shadow.xs,
    },
    ctaIcon: {
      width: 48,
      height: 48,
      borderRadius: 18,
      backgroundColor: Colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
    },
    ctaBody: { flex: 1 },
    ctaCopy: { fontSize: 12, lineHeight: 16, marginTop: 3 },
    emptyState: {
      paddingHorizontal: Spacing.xxl,
      paddingTop: Spacing.xxxl,
      paddingBottom: Spacing.xxl,
      alignItems: 'center',
    },
    emptyIcon: {
      width: 64,
      height: 64,
      borderRadius: 24,
      backgroundColor: Colors.special,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: Spacing.lg,
    },
    emptyTitle: { fontSize: 17, lineHeight: 23 },
    emptyCopy: { fontSize: 13, lineHeight: 18, marginTop: Spacing.sm, maxWidth: 260 },
    retryButton: {
      marginTop: Spacing.lg,
      backgroundColor: Colors.specialAccent,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      borderRadius: Radius.full,
    },
  });
