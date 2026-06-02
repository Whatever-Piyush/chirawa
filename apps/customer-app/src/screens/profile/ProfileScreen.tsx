import React, { useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  Share,
  Modal,
} from 'react-native';
import { useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Spacing } from '../../theme';
import { useTheme, type ColorPalette, type ThemeMode } from '../../theme/ThemeContext';
import { useT } from '@chirawa/i18n';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api.service';
import type { LoyaltyResponse } from '@chirawa/types';
import type { RootStackParamList, TabParamList } from '../../navigation/AppNavigator';
import { Text, FauxGradient } from '../../components/ui';

// Tier visuals — names match the seeded LoyaltyTier rows (bronze/silver/gold).
const TIER_META: Record<string, { emoji: string; color: string }> = {
  bronze: { emoji: '🥉', color: '#CD7F32' },
  silver: { emoji: '🥈', color: '#9CA3AF' },
  gold:   { emoji: '🥇', color: '#F59E0B' },
};

const WHATSAPP_NUMBER = '919999999999';

type NavProp = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;

interface RowData {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  accent?: boolean; // distinct CTA styling (List your shop)
  danger?: boolean; // red label (Log out)
}

// ── A grouped list row (Aesthetic upgrade: separated dividers) ──────────────
function InfoRow({
  icon,
  label,
  onPress,
  accent,
  danger,
  last,
  c,
  styles,
}: RowData & { last: boolean; c: ColorPalette; styles: ReturnType<typeof makeStyles> }) {
  return (
    <>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        style={[styles.row, accent && styles.rowAccent]}
      >
        <View style={styles.rowIconWrap}>{icon}</View>
        <Text
          weight="medium"
          color={danger ? c.error : accent ? c.specialAccent : c.textPrimary}
          style={styles.rowLabel}
        >
          {label}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={danger ? c.error : c.textTertiary} />
      </TouchableOpacity>
      {!last && !accent && <View style={styles.divider} />}
    </>
  );
}

function Section({
  title,
  rows,
  c,
  styles,
}: {
  title: string;
  rows: RowData[];
  c: ColorPalette;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.sectionContainer}>
      <Text weight="semibold" style={styles.sectionTitle}>
        {title}
      </Text>
      <View style={styles.card}>
        {rows.map((r, i) => (
          <InfoRow key={r.label} {...r} last={i === rows.length - 1} c={c} styles={styles} />
        ))}
      </View>
    </View>
  );
}

const MODE_LABEL: Record<ThemeMode, string> = {
  light: 'LIGHT',
  dark: 'DARK',
  system: 'SYSTEM',
};

export default function ProfileScreen() {
  const t = useT();
  const { state, signOut } = useAuth(); // Pulls the global state with the user's name
  const { colors: c, scheme, mode, setMode } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavProp>();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [themeModalOpen, setThemeModalOpen] = React.useState(false);
  const [loyalty, setLoyalty] = React.useState<LoyaltyResponse | null>(null);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await api.getLoyalty();
        if (alive) setLoyalty(data);
      } catch { /* loyalty is non-critical — silently skip the card on failure */ }
    })();
    return () => { alive = false; };
  }, []);

  const tierLabel = (name: string) =>
    t(`profile.tier${name.charAt(0).toUpperCase()}${name.slice(1)}`);

  const phone = state.phone ?? '—';

  // Header gradient adapts to the active scheme.
  const gradientFrom = scheme === 'dark' ? '#3A2418' : '#FFE0B2';
  const gradientTo = scheme === 'dark' ? '#1E1E1E' : '#FFF5EE';

  const soon = (msgKey: string) => () => Alert.alert('Bringly', t(msgKey));

  const handleLogout = () => {
    Alert.alert(t('profile.logoutTitle'), t('profile.logoutBody'), [
      { text: t('profile.logoutStay'), style: 'cancel' },
      {
        text: t('profile.logoutYes'),
        style: 'destructive',
        onPress: () => {
          void signOut();
        },
      },
    ]);
  };

  const handleHelp = () => {
    const msg = encodeURIComponent('Hi, I need help with Bringly app');
    void Linking.openURL(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`);
  };

  const handleShare = () => {
    void Share.share({ message: t('profile.shareMessage') });
  };

  const handleEditProfile = () => navigation.navigate('EditProfile');

  const handleListShop = () => {
    const msg = encodeURIComponent(
      "Hi! I'd like to list my shop on Bringly. My shop name is:",
    );
    void Linking.openURL(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`);
  };

  const handlePickMode = (next: ThemeMode) => {
    setMode(next);
    setThemeModalOpen(false);
  };

  const ICON = (node: React.ReactNode) => node;

  const yourInfo: RowData[] = [
    {
      icon: ICON(<Ionicons name="book-outline" size={20} color={c.textSecondary} />),
      label: t('profile.addressBook'),
      onPress: () => navigation.navigate('AddressList'),
    },
    {
      icon: ICON(<Ionicons name="heart-outline" size={20} color={c.textSecondary} />),
      label: t('profile.wishlist'),
      onPress: soon('profile.wishlistSoon'),
    },
    {
      icon: ICON(<Ionicons name="document-text-outline" size={20} color={c.textSecondary} />),
      label: t('profile.gstDetails'),
      onPress: soon('profile.gstSoon'),
    },
    {
      icon: ICON(<Ionicons name="gift-outline" size={20} color={c.textSecondary} />),
      label: t('profile.rewards'),
      onPress: soon('profile.rewardsSoon'),
    },
  ];

  const otherInfo: RowData[] = [
    {
      icon: ICON(<Ionicons name="share-social-outline" size={20} color={c.textSecondary} />),
      label: t('profile.shareApp'),
      onPress: handleShare,
    },
    {
      icon: ICON(<Ionicons name="information-circle-outline" size={20} color={c.textSecondary} />),
      label: t('profile.aboutUs'),
      onPress: () => Alert.alert('Bringly', t('profile.aboutFull')),
    },
    {
      icon: ICON(
        <MaterialCommunityIcons name="storefront-outline" size={20} color={c.specialAccent} />,
      ),
      label: t('profile.listYourShop'),
      onPress: handleListShop,
      accent: true,
    },
    {
      icon: ICON(<Ionicons name="lock-closed-outline" size={20} color={c.textSecondary} />),
      label: t('profile.accountPrivacy'),
      onPress: () => navigation.navigate('AccountPrivacy'),
    },
    {
      icon: ICON(<Ionicons name="log-out-outline" size={20} color={c.error} />),
      label: t('common.logout'),
      onPress: handleLogout,
      danger: true,
    },
  ];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Gradient header (Elevated Aesthetic) ────────────────────────── */}
        <FauxGradient
          from={gradientFrom}
          to={gradientTo}
          style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}
        >
          <View style={styles.topRow}>
            <TouchableOpacity
              onPress={() => navigation.navigate('Home')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.backBtn}
            >
              <Ionicons name="arrow-back" size={22} color={c.textPrimary} />
            </TouchableOpacity>
            <Text weight="bold" color={c.textPrimary} style={styles.topTitle}>
              {t('profile.title')}
            </Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Tapping the avatar / pencil opens the profile editor */}
          <TouchableOpacity
            style={styles.avatarWrap}
            activeOpacity={0.8}
            onPress={handleEditProfile}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarLetter}>
                {state.name ? state.name.charAt(0).toUpperCase() : '?'}
              </Text>
            </View>
            <View style={styles.editBadge}>
              <Ionicons name="pencil" size={12} color={Colors.white} />
            </View>
          </TouchableOpacity>

          <Text weight="bold" color={c.textPrimary} style={styles.accountTitle}>
            {state.name ? state.name : t('profile.yourAccount')}
          </Text>
          <Text weight="medium" color={c.textSecondary} style={styles.phone}>
            +91 {phone}
          </Text>
        </FauxGradient>

        <View style={styles.body}>
          {/* ── Birthday banner ───────────────────────────────────────────── */}
          <TouchableOpacity activeOpacity={0.8} style={styles.birthday} onPress={handleEditProfile}>
            <View style={{ flex: 1 }}>
              <Text weight="bold" color={c.warning} style={styles.birthdayTitle}>
                {state.dob ? t('profile.birthdaySaved') : t('profile.addBirthday')}
              </Text>
              <Text weight="medium" color={c.textSecondary} style={styles.birthdaySub}>
                {state.dob ? new Date(state.dob).toLocaleDateString() : t('profile.birthdayGift')}
              </Text>
            </View>
            <Text style={styles.cake}>🎂</Text>
          </TouchableOpacity>

          {/* ── Quick tiles (Your orders · Need help?) ────────────────────── */}
          <View style={styles.tiles}>
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.tile}
              onPress={() => navigation.navigate('OrderHistory')}
            >
              <View style={styles.tileIconWrap}>
                <MaterialCommunityIcons name="shopping-outline" size={26} color={c.primary} />
              </View>
              <Text weight="semibold" color={c.textPrimary} style={styles.tileLabel}>
                {t('profile.yourOrders')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.8} style={styles.tile} onPress={handleHelp}>
              <View style={styles.tileIconWrap}>
                <MaterialCommunityIcons name="headset" size={26} color={c.primary} />
              </View>
              <Text weight="semibold" color={c.textPrimary} style={styles.tileLabel}>
                {t('profile.needHelp')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── Loyalty status card (Chunk 7.5) ───────────────────────────── */}
          {loyalty && (
            <View style={styles.loyaltyCard}>
              <View style={styles.loyaltyTop}>
                <Text style={styles.loyaltyEmoji}>{(TIER_META[loyalty.tier] ?? TIER_META.bronze).emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text weight="medium" color={c.textSecondary} style={styles.loyaltyKicker}>
                    {t('profile.loyaltyTitle')}
                  </Text>
                  <Text weight="bold" color={(TIER_META[loyalty.tier] ?? TIER_META.bronze).color} style={styles.loyaltyTier}>
                    {tierLabel(loyalty.tier)}
                  </Text>
                </View>
                <View style={styles.loyaltyOrdersWrap}>
                  <Text weight="bold" color={c.textPrimary} style={styles.loyaltyOrdersNum}>
                    {loyalty.totalOrders}
                  </Text>
                  <Text weight="medium" color={c.textSecondary} style={styles.loyaltyOrdersLabel}>
                    {t('profile.loyaltyOrders')}
                  </Text>
                </View>
              </View>

              <View style={styles.loyaltyTrack}>
                <View
                  style={[
                    styles.loyaltyFill,
                    {
                      width: `${Math.round(loyalty.progress * 100)}%`,
                      backgroundColor: (TIER_META[loyalty.tier] ?? TIER_META.bronze).color,
                    },
                  ]}
                />
              </View>

              <Text weight="medium" color={c.textSecondary} style={styles.loyaltyHint}>
                {loyalty.nextTier
                  ? `${loyalty.ordersToNext} ${t('profile.loyaltyToNext')} ${tierLabel(loyalty.nextTier)}`
                  : t('profile.loyaltyTopTier')}
              </Text>
            </View>
          )}

          {/* ── Appearance row (real theme switcher) ──────────────────────── */}
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.appearance}
            onPress={() => setThemeModalOpen(true)}
          >
            <View style={[styles.rowIconWrap, { backgroundColor: c.warningLight }]}>
              <Ionicons
                name={scheme === 'dark' ? 'moon' : 'sunny-outline'}
                size={20}
                color={c.warning}
              />
            </View>
            <Text weight="medium" color={c.textPrimary} style={styles.appearanceLabel}>
              {t('profile.appearance')}
            </Text>
            <Text weight="bold" color={c.primary} style={styles.appearanceValue}>
              {MODE_LABEL[mode]}
            </Text>
            <Ionicons name="chevron-down" size={16} color={c.primary} />
          </TouchableOpacity>

          {/* ── Sections ──────────────────────────────────────────────────── */}
          <Section title={t('profile.yourInformation')} rows={yourInfo} c={c} styles={styles} />
          <Section title={t('profile.otherInformation')} rows={otherInfo} c={c} styles={styles} />

          {/* ── Version footer ────────────────────────────────────────────── */}
          <View style={[styles.footer, { marginBottom: insets.bottom + Spacing.xl }]}>
            <Text weight="bold" style={styles.footerName}>
              Bringly
            </Text>
            <Text weight="medium" style={styles.footerVersion}>
              v1.0.0
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* ── Appearance picker ───────────────────────────────────────────── */}
      <Modal
        visible={themeModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setThemeModalOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setThemeModalOpen(false)}
        >
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + Spacing.md }]}>
            <Text weight="bold" style={styles.modalTitle}>
              {t('profile.appearance')}
            </Text>
            {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => {
              const active = mode === m;
              return (
                <TouchableOpacity
                  key={m}
                  style={[styles.modalOption, active && styles.modalOptionActive]}
                  activeOpacity={0.7}
                  onPress={() => handlePickMode(m)}
                >
                  <Ionicons
                    name={
                      m === 'light' ? 'sunny-outline' : m === 'dark' ? 'moon-outline' : 'contrast-outline'
                    }
                    size={20}
                    color={active ? c.primary : c.textSecondary}
                  />
                  <Text
                    weight={active ? 'bold' : 'medium'}
                    color={active ? c.primary : c.textPrimary}
                    style={styles.modalOptionLabel}
                  >
                    {t(`profile.theme_${m}`)}
                  </Text>
                  {active && <Ionicons name="checkmark-circle" size={20} color={c.primary} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const makeStyles = (c: ColorPalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { paddingBottom: Spacing.lg },

    // Header
    header: {
      alignItems: 'center',
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.xl,
      borderBottomLeftRadius: 30,
      borderBottomRightRadius: 30,
      shadowColor: '#000',
      shadowOpacity: 0.05,
      shadowRadius: 15,
      shadowOffset: { width: 0, height: 5 },
      elevation: 4,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      marginBottom: Spacing.lg,
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.overlayLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    topTitle: { fontSize: 17, letterSpacing: -0.3 },

    // Premium Avatar
    avatarWrap: { width: 84, height: 84, marginBottom: Spacing.sm },
    avatar: {
      width: 84,
      height: 84,
      borderRadius: 28, // iOS Squircle
      backgroundColor: c.surface,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 5,
    },
    avatarLetter: {
      fontSize: 34,
      fontFamily: 'Poppins_700Bold',
      color: c.primary,
      marginTop: 4,
    },
    editBadge: {
      position: 'absolute',
      bottom: -4,
      right: -4,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: c.primary, // Brand badge
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2.5,
      borderColor: c.background,
    },
    accountTitle: { fontSize: 24, lineHeight: 30, letterSpacing: -0.5 },
    phone: { fontSize: 15, marginTop: 2, letterSpacing: 0.5 },

    // Body
    body: { paddingHorizontal: Spacing.lg, marginTop: Spacing.lg },

    // Birthday banner
    birthday: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.warningLight,
      borderRadius: 20,
      padding: Spacing.lg,
      shadowColor: '#F59E0B',
      shadowOpacity: 0.1,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    birthdayTitle: { fontSize: 15 },
    birthdaySub: { fontSize: 13, marginTop: 2 },
    cake: { fontSize: 42, lineHeight: 48 },

    // Quick tiles
    tiles: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl },
    tile: {
      flex: 1,
      backgroundColor: c.surface,
      borderRadius: 20,
      paddingVertical: Spacing.lg,
      alignItems: 'center',
      gap: Spacing.sm,
      shadowColor: '#000',
      shadowOpacity: 0.04,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    tileIconWrap: {
      width: 50,
      height: 50,
      borderRadius: 16,
      backgroundColor: c.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    tileLabel: { fontSize: 13.5, letterSpacing: -0.2 },

    // Loyalty card
    loyaltyCard: {
      backgroundColor: c.surface,
      borderRadius: 20,
      padding: Spacing.lg,
      marginTop: Spacing.xl,
      gap: Spacing.md,
      shadowColor: '#000',
      shadowOpacity: 0.04,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    loyaltyTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    loyaltyEmoji: { fontSize: 34, lineHeight: 40 },
    loyaltyKicker: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
    loyaltyTier: { fontSize: 20, letterSpacing: -0.3, marginTop: 1 },
    loyaltyOrdersWrap: { alignItems: 'flex-end' },
    loyaltyOrdersNum: { fontSize: 24, lineHeight: 28 },
    loyaltyOrdersLabel: { fontSize: 11, textAlign: 'right', maxWidth: 80 },
    loyaltyTrack: { height: 8, borderRadius: 4, backgroundColor: c.surfaceAlt, overflow: 'hidden' },
    loyaltyFill: { height: 8, borderRadius: 4 },
    loyaltyHint: { fontSize: 13 },

    // Appearance
    appearance: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      borderRadius: 20,
      padding: Spacing.md,
      paddingHorizontal: Spacing.lg,
      marginTop: Spacing.xl,
      gap: Spacing.md,
      shadowColor: '#000',
      shadowOpacity: 0.03,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    appearanceLabel: { flex: 1, fontSize: 15 },
    appearanceValue: { fontSize: 13, marginRight: 4, letterSpacing: 1 },

    // Sections
    sectionContainer: { marginTop: Spacing.xl },
    sectionTitle: {
      fontSize: 13,
      color: c.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: Spacing.md,
      paddingLeft: 8,
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: 20,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.03,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Spacing.lg,
      paddingVertical: 16,
      gap: 14,
      minHeight: 60,
    },
    rowAccent: { backgroundColor: c.special },
    rowIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: c.surfaceAlt,
      justifyContent: 'center',
      alignItems: 'center',
    },
    rowLabel: { flex: 1, fontSize: 15 },
    divider: {
      height: 1,
      backgroundColor: c.divider,
      marginLeft: 70, // Native iOS offset (skips the icon completely)
    },

    // Footer
    footer: { alignItems: 'center', marginTop: 40 },
    footerName: { fontSize: 15, color: c.textTertiary, letterSpacing: 1 },
    footerVersion: { fontSize: 12, color: c.textTertiary, marginTop: 4, letterSpacing: 0.5 },

    // Appearance modal
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    modalSheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.lg,
    },
    modalTitle: { fontSize: 16, color: c.textPrimary, marginBottom: Spacing.md },
    modalOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: 14,
      paddingHorizontal: Spacing.md,
      borderRadius: 14,
    },
    modalOptionActive: { backgroundColor: c.primaryLight },
    modalOptionLabel: { flex: 1, fontSize: 15 },
  });
