import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  Share,
} from 'react-native';
import { useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Spacing } from '../../theme';
import { useT } from '@chirawa/i18n';
import { useAuth } from '../../context/AuthContext';
import type { RootStackParamList, TabParamList } from '../../navigation/AppNavigator';
import { Text, FauxGradient } from '../../components/ui';

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
function InfoRow({ icon, label, onPress, accent, danger, last }: RowData & { last: boolean }) {
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
          color={danger ? '#FF3B30' : accent ? Colors.specialAccent : '#1F2937'}
          style={styles.rowLabel}
        >
          {label}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={danger ? '#FF3B30' : '#D1D5DB'} />
      </TouchableOpacity>
      {!last && !accent && <View style={styles.divider} />}
    </>
  );
}

function Section({ title, rows }: { title: string; rows: RowData[] }) {
  return (
    <View style={styles.sectionContainer}>
      <Text weight="semibold" style={styles.sectionTitle}>
        {title}
      </Text>
      <View style={styles.card}>
        {rows.map((r, i) => (
          <InfoRow key={r.label} {...r} last={i === rows.length - 1} />
        ))}
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const t = useT();
  const { state, signOut } = useAuth(); // 🔴 Pulls the global state with the user's name
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavProp>();

  const phone = state.phone ?? '—';

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

  const ICON = (node: React.ReactNode) => node;

  const yourInfo: RowData[] = [
    {
      icon: ICON(<Ionicons name="book-outline" size={20} color="#6B7280" />),
      label: t('profile.addressBook'),
      onPress: () => navigation.navigate('AddressList'),
    },
    {
      icon: ICON(<Ionicons name="heart-outline" size={20} color="#6B7280" />),
      label: t('profile.wishlist'),
      onPress: soon('profile.wishlistSoon'),
    },
    {
      icon: ICON(<Ionicons name="document-text-outline" size={20} color="#6B7280" />),
      label: t('profile.gstDetails'),
      onPress: soon('profile.gstSoon'),
    },
    {
      icon: ICON(<Ionicons name="gift-outline" size={20} color="#6B7280" />),
      label: t('profile.rewards'),
      onPress: soon('profile.rewardsSoon'),
    },
  ];

  const otherInfo: RowData[] = [
    {
      icon: ICON(<Ionicons name="share-social-outline" size={20} color="#6B7280" />),
      label: t('profile.shareApp'),
      onPress: handleShare,
    },
    {
      icon: ICON(<Ionicons name="information-circle-outline" size={20} color="#6B7280" />),
      label: t('profile.aboutUs'),
      onPress: () => Alert.alert('Bringly', t('profile.aboutFull')),
    },
    {
      icon: ICON(
        <MaterialCommunityIcons name="storefront-outline" size={20} color={Colors.specialAccent} />,
      ),
      label: t('profile.listYourShop'),
      onPress: soon('profile.listShopSoon'),
      accent: true,
    },
    {
      icon: ICON(<Ionicons name="lock-closed-outline" size={20} color="#6B7280" />),
      label: t('profile.accountPrivacy'),
      onPress: soon('profile.privacySoon'),
    },
    {
      icon: ICON(<Ionicons name="log-out-outline" size={20} color="#FF3B30" />),
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
          from="#FFE0B2"
          to="#FFF5EE"
          style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}
        >
          <View style={styles.topRow}>
            <TouchableOpacity
              onPress={() => navigation.navigate('Home')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.backBtn}
            >
              <Ionicons name="arrow-back" size={22} color="#111827" />
            </TouchableOpacity>
            <Text weight="bold" color="#111827" style={styles.topTitle}>
              {t('profile.title')}
            </Text>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              {/* 🔴 Dynamic Initial Applied Here */}
              <Text style={styles.avatarLetter}>
                {state.name ? state.name.charAt(0).toUpperCase() : '?'}
              </Text>
            </View>
            <View style={styles.editBadge}>
              <Ionicons name="pencil" size={12} color={Colors.white} />
            </View>
          </View>
          {/* 🔴 Dynamic Display Name Applied Here */}
          <Text weight="bold" color="#111827" style={styles.accountTitle}>
            {state.name ? state.name : t('profile.yourAccount')}
          </Text>
          <Text weight="medium" color="#4B5563" style={styles.phone}>
            +91 {phone}
          </Text>
        </FauxGradient>

        <View style={styles.body}>
          {/* ── Birthday banner ───────────────────────────────────────────── */}
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.birthday}
            onPress={soon('profile.birthdaySoon')}
          >
            <View style={{ flex: 1 }}>
              <Text weight="bold" color="#92400E" style={styles.birthdayTitle}>
                {t('profile.addBirthday')}
              </Text>
              <Text weight="medium" color="#B45309" style={styles.birthdaySub}>
                {t('profile.birthdayGift')}
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
                <MaterialCommunityIcons name="shopping-outline" size={26} color={Colors.primary} />
              </View>
              <Text weight="semibold" color="#374151" style={styles.tileLabel}>
                {t('profile.yourOrders')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.8} style={styles.tile} onPress={handleHelp}>
              <View style={styles.tileIconWrap}>
                <MaterialCommunityIcons name="headset" size={26} color={Colors.primary} />
              </View>
              <Text weight="semibold" color="#374151" style={styles.tileLabel}>
                {t('profile.needHelp')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── Appearance row ────────────────────────────────────────────── */}
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.appearance}
            onPress={soon('profile.appearanceSoon')}
          >
            <View style={[styles.rowIconWrap, { backgroundColor: '#FFF7ED' }]}>
              <Ionicons name="sunny-outline" size={20} color="#F97316" />
            </View>
            <Text weight="medium" color="#1F2937" style={styles.appearanceLabel}>
              {t('profile.appearance')}
            </Text>
            <Text weight="bold" color={Colors.primary} style={styles.appearanceValue}>
              LIGHT
            </Text>
            <Ionicons name="chevron-down" size={16} color={Colors.primary} />
          </TouchableOpacity>

          {/* ── Sections ──────────────────────────────────────────────────── */}
          <Section title={t('profile.yourInformation')} rows={yourInfo} />
          <Section title={t('profile.otherInformation')} rows={otherInfo} />

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
    </View>
  );
}

const styles = StyleSheet.create({
  // Background updated to #F9FAFB for premium contrast against white cards
  container: { flex: 1, backgroundColor: '#F9FAFB' },
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
    backgroundColor: 'rgba(255,255,255,0.5)',
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
    backgroundColor: Colors.white,
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
    color: Colors.primary,
    marginTop: 4,
  },
  editBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#111827', // Contrast badge
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: '#FFF5EE', // Matches gradient bottom
  },
  accountTitle: { fontSize: 24, lineHeight: 30, letterSpacing: -0.5 },
  phone: { fontSize: 15, marginTop: 2, letterSpacing: 0.5 },

  // Body
  body: { paddingHorizontal: Spacing.lg, marginTop: Spacing.lg },

  // Birthday banner
  birthday: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
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
    backgroundColor: Colors.white,
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
    backgroundColor: 'rgba(212, 66, 74, 0.08)', // Soft tint of primary color
    justifyContent: 'center',
    alignItems: 'center',
  },
  tileLabel: { fontSize: 13.5, letterSpacing: -0.2 },

  // Appearance
  appearance: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
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
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.md,
    paddingLeft: 8,
  },
  card: {
    backgroundColor: Colors.white,
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
  rowAccent: { backgroundColor: '#FFF7ED' },
  rowIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowLabel: { flex: 1, fontSize: 15 },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginLeft: 70, // Native iOS offset (skips the icon completely)
  },

  // Footer
  footer: { alignItems: 'center', marginTop: 40 },
  footerName: { fontSize: 15, color: '#D1D5DB', letterSpacing: 1 },
  footerVersion: { fontSize: 12, color: '#9CA3AF', marginTop: 4, letterSpacing: 0.5 },
});
