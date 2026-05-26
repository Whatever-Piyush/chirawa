import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSize, MIN_TAP, Radius, Shadow, Spacing, Gradients } from '../../theme';
import { useT } from '@chirawa/i18n';
import { useAuth } from '../../context/AuthContext';
import FauxGradient from '../../components/ui/FauxGradient';
import PressableScale from '../../components/ui/PressableScale';

const WHATSAPP_NUMBER = '919999999999';

interface MenuItem {
  emoji:   string;
  labelKey: string;
  onPress: () => void;
}

export default function ProfileScreen() {
  const t = useT();
  const { state, signOut } = useAuth();
  const insets = useSafeAreaInsets();

  const phone   = state.phone ?? '—';
  const initial = (phone && phone.length > 0 ? phone[phone.length - 1] : 'U') as string;

  const handleHelp = () => {
    const msg = encodeURIComponent('Hi, I need help with Bringly app');
    void Linking.openURL(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`);
  };

  const handleAbout = () => {
    Alert.alert('Bringly', t('profile.aboutText'));
  };

  const handleAddresses = () => {
    Alert.alert('📍', t('common.comingSoon'));
  };

  const handleLogout = () => {
    Alert.alert(t('common.logout'), t('profile.logoutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.logout'),
        style: 'destructive',
        onPress: () => { void signOut(); },
      },
    ]);
  };

  const items: MenuItem[] = [
    { emoji: '📦', labelKey: 'profile.myOrders', onPress: () => undefined }, // tab-only nav placeholder
    { emoji: '📍', labelKey: 'profile.addresses', onPress: handleAddresses },
    { emoji: '❓', labelKey: 'profile.help', onPress: handleHelp },
    { emoji: 'ℹ️', labelKey: 'profile.aboutApp', onPress: handleAbout },
  ];

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top, paddingBottom: insets.bottom + Spacing.xxxl }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header card */}
        <FauxGradient
          from={Gradients.primary[0]}
          to={Gradients.primary[1]}
          style={[styles.headerCard, { paddingTop: Spacing.xl }]}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={styles.phoneText}>+91 {phone}</Text>
          <View style={styles.memberBadge}>
            <Text style={styles.memberBadgeText}>✨  {t('profile.member')}</Text>
          </View>
        </FauxGradient>

        {/* Menu items */}
        <View style={styles.menu}>
          {items.map((it) => (
            <PressableScale
              key={it.labelKey}
              onPress={it.onPress}
              style={styles.menuItem}
            >
              <Text style={styles.menuEmoji}>{it.emoji}</Text>
              <Text style={styles.menuLabel}>{t(it.labelKey)}</Text>
              <Text style={styles.menuChevron}>›</Text>
            </PressableScale>
          ))}
        </View>

        {/* Logout */}
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={handleLogout}
          activeOpacity={0.85}
        >
          <Text style={styles.logoutBtnText}>{t('common.logout')}</Text>
        </TouchableOpacity>

        {/* Footer */}
        <Text style={styles.versionFooter}>{t('profile.versionFooter')}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll:    { paddingHorizontal: 0, gap: Spacing.lg },

  // Header
  headerCard: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.sm,
    borderBottomLeftRadius:  Radius.xl,
    borderBottomRightRadius: Radius.xl,
  },
  avatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 3, borderColor: Colors.white,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  avatarText: {
    color: Colors.white,
    fontSize: 38,
    fontWeight: '900',
  },
  phoneText: {
    color: Colors.white,
    fontSize: FontSize.xl,
    fontWeight: '900',
  },
  memberBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radius.full,
    marginTop: 4,
  },
  memberBadgeText: {
    color: Colors.white,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },

  // Menu
  menu: {
    marginHorizontal: Spacing.lg,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.card,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: MIN_TAP + 8,
    gap: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  menuEmoji: { fontSize: 22 },
  menuLabel: { flex: 1, fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  menuChevron: { fontSize: 24, color: Colors.textMuted, fontWeight: '700' },

  // Logout
  logoutBtn: {
    marginHorizontal: Spacing.lg,
    minHeight: MIN_TAP,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.error,
    backgroundColor: Colors.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutBtnText: {
    color: Colors.error,
    fontWeight: '800',
    fontSize: FontSize.md,
  },

  // Footer
  versionFooter: {
    textAlign: 'center',
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '700',
    marginTop: Spacing.md,
  },
});
