import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize, FontWeight, MIN_TAP, Radius, Shadow, Spacing, Gradients } from '../../theme';
import { useT, useLanguage } from '@chirawa/i18n';
import { useAuth } from '../../context/AuthContext';
import type { TabParamList } from '../../navigation/AppNavigator';
import FauxGradient from '../../components/ui/FauxGradient';

const WHATSAPP_NUMBER = '919999999999';

type NavProp = BottomTabNavigationProp<TabParamList>;

interface MenuItemData {
  emoji:   string;
  label:   string;
  onPress: () => void;
}

// ─── Reusable menu pieces ─────────────────────────────────────────────────────

function MenuRow({ emoji, label, onPress }: MenuItemData) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.menuEmoji}>{emoji}</Text>
      <Text style={styles.menuLabel}>{label}</Text>
      <Text style={styles.menuChevron}>›</Text>
    </TouchableOpacity>
  );
}

function MenuCard({ items }: { items: MenuItemData[] }) {
  return (
    <View style={styles.menuCard}>
      {items.map((it, idx) => (
        <React.Fragment key={it.label}>
          <MenuRow {...it} />
          {idx < items.length - 1 && <View style={styles.menuDivider} />}
        </React.Fragment>
      ))}
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const t = useT();
  const { state, signOut } = useAuth();
  const { setLanguage } = useLanguage();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavProp>();

  const phone   = state.phone ?? '—';
  const initial = (phone !== '—' && phone.length > 0 ? phone[0] : 'U') as string;

  const openWhatsApp = () => {
    const msg = encodeURIComponent('Hi, I need help with Bringly app');
    void Linking.openURL(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`);
  };

  const handleLanguage = () => {
    Alert.alert(t('profile.chooseLanguage'), undefined, [
      { text: 'हिंदी',  onPress: () => setLanguage('hi') },
      { text: 'English', onPress: () => setLanguage('en') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const handleLogout = () => {
    Alert.alert(t('profile.logoutTitle'), t('profile.logoutBody'), [
      { text: t('profile.logoutStay'), style: 'cancel' },
      { text: t('profile.logoutYes'),  style: 'destructive', onPress: () => { void signOut(); } },
    ]);
  };

  const accountItems: MenuItemData[] = [
    { emoji: '📦', label: t('profile.myOrders'),    onPress: () => navigation.navigate('OrderHistory') },
    { emoji: '📍', label: t('profile.myAddresses'), onPress: () => Alert.alert('📍', t('profile.addressSoon')) },
  ];

  const settingsItems: MenuItemData[] = [
    { emoji: '🌐', label: t('profile.changeLanguage'), onPress: handleLanguage },
    { emoji: '🔔', label: t('profile.notifications'),  onPress: () => Alert.alert('🔔', t('profile.notifSoon')) },
  ];

  const helpItems: MenuItemData[] = [
    { emoji: '💬', label: t('profile.whatsappSupport'), onPress: openWhatsApp },
    { emoji: '⭐', label: t('profile.rateApp'),         onPress: () => Alert.alert('⭐', t('profile.rateSoon')) },
    { emoji: 'ℹ️', label: t('profile.aboutApp'),        onPress: () => Alert.alert('Bringly', t('profile.aboutFull')) },
  ];

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <FauxGradient
          from={Gradients.primary[0]}
          to={Gradients.primary[1]}
          style={[styles.header, { paddingTop: insets.top + Spacing.lg }]}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={styles.phoneText}>+91 {phone}</Text>
          <View style={styles.memberBadge}>
            <Text style={styles.memberBadgeText}>✨  Bringly {t('profile.member')}</Text>
          </View>
        </FauxGradient>

        {/* ── Menu sections ───────────────────────────────────────────────── */}
        <View style={styles.body}>
          <MenuCard items={accountItems} />

          <Text style={styles.sectionTitle}>{t('profile.settings')}</Text>
          <MenuCard items={settingsItems} />

          <Text style={styles.sectionTitle}>{t('profile.helpSection')}</Text>
          <MenuCard items={helpItems} />

          {/* Logout */}
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
            <Text style={styles.logoutBtnText}>🚪  {t('common.logout')}</Text>
          </TouchableOpacity>

          {/* Footer */}
          <Text style={[styles.footer, { marginBottom: insets.bottom + Spacing.lg }]}>
            {t('profile.versionFooter')}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll:    { paddingBottom: Spacing.xxxl },

  // Header
  header: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.sm,
    borderBottomLeftRadius:  Radius.xl,
    borderBottomRightRadius: Radius.xl,
  },
  avatar: {
    width: 72, height: 72, borderRadius: Radius.full,
    backgroundColor: Colors.primaryDark,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: {
    color: Colors.white,
    fontSize: FontSize.xxxl,
    fontWeight: FontWeight.bold,
  },
  phoneText: {
    color: Colors.white,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    marginTop: Spacing.md,
  },
  memberBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radius.full,
    marginTop: Spacing.sm,
  },
  memberBadgeText: {
    color: Colors.white,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },

  // Body
  body: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textMuted,
    paddingBottom: Spacing.sm,
    marginTop: Spacing.xs,
    textTransform: 'uppercase',
  },

  // Menu card
  menuCard: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    marginBottom: Spacing.md,
    ...Shadow.sm,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    minHeight: MIN_TAP,
    gap: Spacing.md,
  },
  menuEmoji:   { fontSize: 22 },
  menuLabel:   { flex: 1, fontSize: FontSize.md, fontWeight: FontWeight.medium, color: Colors.textPrimary },
  menuChevron: { fontSize: FontSize.xl, color: Colors.textMuted, fontWeight: FontWeight.bold },
  menuDivider: { height: 1, backgroundColor: Colors.border },

  // Logout
  logoutBtn: {
    marginTop: Spacing.sm,
    height: 52,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.error,
    backgroundColor: Colors.errorLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutBtnText: {
    color: Colors.error,
    fontWeight: FontWeight.semibold,
    fontSize: FontSize.md,
  },

  // Footer
  footer: {
    textAlign: 'center',
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    marginTop: Spacing.xxl,
  },
});
