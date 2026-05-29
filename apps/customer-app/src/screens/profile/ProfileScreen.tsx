import React from 'react';
import {
  View, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking, Share,
} from 'react-native';
import { useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Radius, Shadow, Spacing } from '../../theme';
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
  icon:     React.ReactNode;
  label:    string;
  onPress:  () => void;
  accent?:  boolean;   // distinct CTA styling (List your shop)
  danger?:  boolean;   // red label (Log out)
}

// ── A grouped list row ────────────────────────────────────────────────────────
function InfoRow({ icon, label, onPress, accent, danger, last }: RowData & { last: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.row,
        accent && styles.rowAccent,
        !last && styles.rowBorder,
      ]}
    >
      <View style={styles.rowIcon}>{icon}</View>
      <Text
        weight="regular"
        color={danger ? Colors.error : accent ? Colors.specialAccent : Colors.textPrimary}
        style={styles.rowLabel}
      >
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={18} color={danger ? Colors.error : '#BBB'} />
    </TouchableOpacity>
  );
}

function Section({ title, rows }: { title: string; rows: RowData[] }) {
  return (
    <>
      <Text weight="semibold" color={Colors.textPrimary} style={styles.sectionTitle}>
        {title}
      </Text>
      <View style={styles.card}>
        {rows.map((r, i) => (
          <InfoRow key={r.label} {...r} last={i === rows.length - 1} />
        ))}
      </View>
    </>
  );
}

export default function ProfileScreen() {
  const t = useT();
  const { state, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavProp>();

  const phone = state.phone ?? '—';

  const soon = (msgKey: string) => () => Alert.alert('Bringly', t(msgKey));

  const handleLogout = () => {
    Alert.alert(t('profile.logoutTitle'), t('profile.logoutBody'), [
      { text: t('profile.logoutStay'), style: 'cancel' },
      { text: t('profile.logoutYes'), style: 'destructive', onPress: () => { void signOut(); } },
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
    { icon: ICON(<Ionicons name="book-outline" size={20} color="#777" />),          label: t('profile.addressBook'), onPress: () => navigation.navigate('AddressList') },
    { icon: ICON(<Ionicons name="heart-outline" size={20} color="#777" />),         label: t('profile.wishlist'),    onPress: soon('profile.wishlistSoon') },
    { icon: ICON(<Ionicons name="document-text-outline" size={20} color="#777" />), label: t('profile.gstDetails'),  onPress: soon('profile.gstSoon') },
    { icon: ICON(<Ionicons name="gift-outline" size={20} color="#777" />),          label: t('profile.rewards'),     onPress: soon('profile.rewardsSoon') },
  ];

  const otherInfo: RowData[] = [
    { icon: ICON(<Ionicons name="share-social-outline" size={20} color="#777" />),       label: t('profile.shareApp'),       onPress: handleShare },
    { icon: ICON(<Ionicons name="information-circle-outline" size={20} color="#777" />), label: t('profile.aboutUs'),        onPress: () => Alert.alert('Bringly', t('profile.aboutFull')) },
    { icon: ICON(<MaterialCommunityIcons name="storefront-outline" size={20} color={Colors.specialAccent} />), label: t('profile.listYourShop'), onPress: soon('profile.listShopSoon'), accent: true },
    { icon: ICON(<Ionicons name="lock-closed-outline" size={20} color="#777" />),        label: t('profile.accountPrivacy'), onPress: soon('profile.privacySoon') },
    { icon: ICON(<Ionicons name="log-out-outline" size={20} color={Colors.error} />),    label: t('common.logout'),          onPress: handleLogout, danger: true },
  ];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Gradient header ─────────────────────────────────────────────── */}
        <FauxGradient from="#FFE0B2" to="#FFF5EE" style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
          <View style={styles.topRow}>
            <TouchableOpacity
              onPress={() => navigation.navigate('Home')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="arrow-back" size={24} color="#333" />
            </TouchableOpacity>
            <Text weight="semibold" color="#333" style={styles.topTitle}>{t('profile.title')}</Text>
            <View style={{ width: 24 }} />
          </View>

          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={44} color="#999" />
            </View>
            <View style={styles.editBadge}>
              <Ionicons name="pencil" size={11} color={Colors.white} />
            </View>
          </View>
          <Text weight="bold" color="#1A1A2E" style={styles.accountTitle}>{t('profile.yourAccount')}</Text>
          <Text weight="regular" color={Colors.textSecondary} style={styles.phone}>+91 {phone}</Text>
        </FauxGradient>

        <View style={styles.body}>
          {/* ── Birthday banner ───────────────────────────────────────────── */}
          <TouchableOpacity activeOpacity={0.85} style={styles.birthday} onPress={soon('profile.birthdaySoon')}>
            <View style={{ flex: 1 }}>
              <Text weight="semibold" color={Colors.textPrimary} style={styles.birthdayTitle}>
                {t('profile.addBirthday')}
              </Text>
              <Text weight="regular" color={Colors.textSecondary} style={styles.birthdaySub}>
                {t('profile.birthdayGift')}
              </Text>
            </View>
            <Text style={styles.cake}>🎂</Text>
          </TouchableOpacity>

          {/* ── Quick tiles (Your orders · Need help?) ────────────────────── */}
          <View style={styles.tiles}>
            <TouchableOpacity activeOpacity={0.85} style={styles.tile} onPress={() => navigation.navigate('OrderHistory')}>
              <MaterialCommunityIcons name="shopping-outline" size={30} color={Colors.primary} />
              <Text weight="medium" color={Colors.textPrimary} style={styles.tileLabel}>{t('profile.yourOrders')}</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.85} style={styles.tile} onPress={handleHelp}>
              <MaterialCommunityIcons name="headset" size={30} color={Colors.primary} />
              <Text weight="medium" color={Colors.textPrimary} style={styles.tileLabel}>{t('profile.needHelp')}</Text>
            </TouchableOpacity>
          </View>

          {/* ── Appearance row ────────────────────────────────────────────── */}
          <TouchableOpacity activeOpacity={0.85} style={styles.appearance} onPress={soon('profile.appearanceSoon')}>
            <Ionicons name="sunny-outline" size={20} color="#F4A261" />
            <Text weight="medium" color={Colors.textPrimary} style={styles.appearanceLabel}>{t('profile.appearance')}</Text>
            <Text weight="semibold" color={Colors.primary} style={styles.appearanceValue}>LIGHT</Text>
            <Ionicons name="chevron-down" size={16} color={Colors.primary} />
          </TouchableOpacity>

          {/* ── Sections ──────────────────────────────────────────────────── */}
          <Section title={t('profile.yourInformation')} rows={yourInfo} />
          <Section title={t('profile.otherInformation')} rows={otherInfo} />

          {/* ── Version footer ────────────────────────────────────────────── */}
          <View style={[styles.footer, { marginBottom: insets.bottom + Spacing.xl }]}>
            <Text weight="bold" style={styles.footerName}>Bringly</Text>
            <Text weight="regular" style={styles.footerVersion}>v1.0.0</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll:    { paddingBottom: Spacing.lg },

  // Header
  header: {
    alignItems:    'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  topRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    width:          '100%',
    marginBottom:   Spacing.md,
  },
  topTitle: { fontSize: 16 },
  avatarWrap: { width: 80, height: 80 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#E0E0E0',
    justifyContent: 'center', alignItems: 'center',
  },
  editBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: Colors.white,
  },
  accountTitle: { fontSize: 22, lineHeight: 28, marginTop: Spacing.md },
  phone:        { fontSize: 14, marginTop: 2 },

  // Body
  body: { paddingHorizontal: Spacing.lg, marginTop: Spacing.lg },

  // Birthday banner
  birthday: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFF8E1',
    borderColor: '#FFE082', borderWidth: 1,
    borderRadius: 14, padding: Spacing.lg,
  },
  birthdayTitle: { fontSize: 14 },
  birthdaySub:   { fontSize: 12, marginTop: 2 },
  cake:          { fontSize: 40, lineHeight: 46 },

  // Quick tiles
  tiles: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.lg },
  tile: {
    flex: 1, height: 90,
    backgroundColor: Colors.surface,
    borderRadius: 14, borderWidth: 1, borderColor: Colors.border,
    justifyContent: 'center', alignItems: 'center', gap: Spacing.sm,
    ...Shadow.sm,
  },
  tileLabel: { fontSize: 13 },

  // Appearance
  appearance: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14, borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.lg, marginTop: Spacing.lg, gap: Spacing.md,
    ...Shadow.sm,
  },
  appearanceLabel: { flex: 1, fontSize: 14 },
  appearanceValue: { fontSize: 13, marginRight: 2 },

  // Sections
  sectionTitle: { fontSize: 16, marginTop: Spacing.xl, marginBottom: Spacing.sm },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: 14,
    gap: 14, minHeight: 52,
  },
  rowBorder: { borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  rowAccent: { backgroundColor: '#FFF3E0' },
  rowIcon:   { width: 22, alignItems: 'center' },
  rowLabel:  { flex: 1, fontSize: 14 },

  // Footer
  footer: { alignItems: 'center', marginTop: Spacing.xxl },
  footerName:    { fontSize: 16, color: '#CCC' },
  footerVersion: { fontSize: 12, color: '#BBB', marginTop: 2 },
});
