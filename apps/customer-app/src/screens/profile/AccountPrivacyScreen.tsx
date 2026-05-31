import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { useT } from '@chirawa/i18n';
import { useAuth } from '../../context/AuthContext';
import { Text } from '../../components/ui';

const WHATSAPP_NUMBER = '919999999999';
const PRIVACY_URL = 'https://chirawa.in/privacy';
const TERMS_URL = 'https://chirawa.in/terms';

interface RowData {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  danger?: boolean;
}

export default function AccountPrivacyScreen() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { state } = useAuth();
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);

  const openWhatsApp = (msgKey: string) => {
    const msg = encodeURIComponent(t(msgKey));
    void Linking.openURL(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`);
  };

  const handleDelete = () => {
    Alert.alert(t('profile.deleteConfirmTitle'), t('profile.deleteConfirmBody'), [
      { text: t('profile.logoutStay'), style: 'cancel' },
      {
        text: t('profile.deleteAccount'),
        style: 'destructive',
        onPress: () => openWhatsApp('profile.deleteRequestMsg'),
      },
    ]);
  };

  const legal: RowData[] = [
    { icon: 'shield-checkmark-outline', label: t('profile.privacyPolicy'), onPress: () => void Linking.openURL(PRIVACY_URL) },
    { icon: 'document-text-outline', label: t('profile.terms'), onPress: () => void Linking.openURL(TERMS_URL) },
  ];

  const data: RowData[] = [
    { icon: 'download-outline', label: t('profile.downloadData'), onPress: () => openWhatsApp('profile.dataRequestMsg') },
    { icon: 'trash-outline', label: t('profile.deleteAccount'), onPress: handleDelete, danger: true },
  ];

  const renderSection = (title: string, rows: RowData[]) => (
    <View style={styles.sectionContainer}>
      <Text weight="semibold" style={styles.sectionTitle}>
        {title}
      </Text>
      <View style={styles.card}>
        {rows.map((r, i) => (
          <React.Fragment key={r.label}>
            <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={r.onPress}>
              <View style={styles.rowIconWrap}>
                <Ionicons name={r.icon} size={20} color={r.danger ? c.error : c.textSecondary} />
              </View>
              <Text weight="medium" color={r.danger ? c.error : c.textPrimary} style={styles.rowLabel}>
                {r.label}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={r.danger ? c.error : c.textTertiary} />
            </TouchableOpacity>
            {i < rows.length - 1 && <View style={styles.divider} />}
          </React.Fragment>
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Account summary */}
        <View style={styles.summary}>
          <View style={styles.avatar}>
            <Text style={styles.avatarLetter}>
              {state.name ? state.name.charAt(0).toUpperCase() : '?'}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text weight="bold" color={c.textPrimary} style={styles.summaryName}>
              {state.name ?? t('profile.yourAccount')}
            </Text>
            <Text weight="medium" color={c.textSecondary} style={styles.summaryPhone}>
              +91 {state.phone ?? '—'}
            </Text>
          </View>
        </View>

        {renderSection(t('profile.privacyLegal'), legal)}
        {renderSection(t('profile.privacyData'), data)}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ColorPalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { padding: Spacing.lg },

    summary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      backgroundColor: c.surface,
      borderRadius: 20,
      padding: Spacing.lg,
      shadowColor: '#000',
      shadowOpacity: 0.04,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 20,
      backgroundColor: c.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarLetter: { fontSize: 24, fontFamily: 'Poppins_700Bold', color: c.primary, marginTop: 2 },
    summaryName: { fontSize: 18, letterSpacing: -0.3 },
    summaryPhone: { fontSize: 14, marginTop: 2, letterSpacing: 0.5 },

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
    rowIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: c.surfaceAlt,
      justifyContent: 'center',
      alignItems: 'center',
    },
    rowLabel: { flex: 1, fontSize: 15 },
    divider: { height: 1, backgroundColor: c.divider, marginLeft: 70 },
  });
