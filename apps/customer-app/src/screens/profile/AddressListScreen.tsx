import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity, Alert, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AddressResponse } from '@chirawa/types';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { Text, Shimmer } from '../../components/ui';
import { FontSize, FontWeight, Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';
import { useAuth } from '../../context/AuthContext';
import AddressCard from '../../components/location/AddressCard';
import AddressActionsSheet from '../../components/location/AddressActionsSheet';
import { shareAddress } from '../../utils/shareAddress';

type Props = NativeStackScreenProps<RootStackParamList, 'AddressList'>;

const WHATSAPP_GREEN = '#25D366';

// Hindi label value → the add-form's label choice (for prefilling Edit).
function labelChoiceOf(label: string | null | undefined): 'home' | 'work' | 'hotel' | 'other' {
  return label === 'घर' ? 'home' : label === 'दुकान' ? 'work' : label === 'होटल' ? 'hotel' : 'other';
}

export default function AddressListScreen({ navigation }: Props) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const { state } = useAuth();

  const [addresses, setAddresses] = useState<AddressResponse[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(false);
  const [menuFor, setMenuFor]     = useState<AddressResponse | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: t('address.title') });
  }, [navigation, t]);

  const load = useCallback(async () => {
    setError(false);
    try {
      const data = await api.getAddresses();
      data.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      setAddresses(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => navigation.addListener('focus', () => { void load(); }), [navigation, load]);

  const handleSetDefault = useCallback(async (a: AddressResponse) => {
    if (a.isDefault) return;
    try { await api.setDefaultAddress(a.id); await load(); }
    catch (e) { Alert.alert(t('common.error'), e instanceof Error ? e.message : t('common.retry')); }
  }, [load, t]);

  const handleDelete = useCallback((a: AddressResponse) => {
    Alert.alert(t('address.deleteConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('address.delete'), style: 'destructive',
        onPress: async () => {
          try { await api.deleteAddress(a.id); await load(); }
          catch (e) { Alert.alert(t('common.error'), e instanceof Error ? e.message : t('common.retry')); }
        },
      },
    ]);
  }, [load, t]);

  // Open the add-address form prefilled for editing this address.
  const handleEdit = useCallback((a: AddressResponse) => {
    navigation.navigate('AddressDetails', {
      lat: a.lat, lng: a.lng,
      title: a.locality, subtitle: `${a.street}, ${a.locality}`,
      locality: a.locality, city: a.city, pincode: a.pincode,
      editId: a.id,
      initialHouse: a.street,
      initialLandmark: a.landmark && a.landmark !== '—' ? a.landmark : '',
      initialLabel: labelChoiceOf(a.label),
      receiverName: a.receiverName ?? undefined,
      receiverPhone: a.receiverPhone ?? undefined,
    });
  }, [navigation]);

  const requestFromOther = useCallback(() => {
    const qs = [
      state.name  ? `from=${encodeURIComponent(state.name)}`   : null,
      state.phone ? `phone=${encodeURIComponent(state.phone)}` : null,
    ].filter(Boolean).join('&');
    const link = `bringly://share-address${qs ? `?${qs}` : ''}`;
    const msg  = encodeURIComponent(`${t('locationSheet.requestMessage')}\n${link}`);
    void Linking.openURL(`https://wa.me/?text=${msg}`).catch(() => {});
  }, [state.name, state.phone, t]);

  const Header = (
    <View style={styles.headerWrap}>
      <View style={styles.actionCard}>
        <TouchableOpacity style={styles.actionRow} activeOpacity={0.7} onPress={() => navigation.navigate('AddressMap')}>
          <View style={[styles.actionIcon, { backgroundColor: `${Colors.primary}1A` }]}>
            <Ionicons name="add" size={20} color={Colors.primary} />
          </View>
          <Text weight="semibold" color={Colors.primary} style={styles.actionLabel}>{t('locationSheet.addNew')}</Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.actionRow} activeOpacity={0.7} onPress={requestFromOther}>
          <View style={[styles.actionIcon, { backgroundColor: `${WHATSAPP_GREEN}1A` }]}>
            <Ionicons name="logo-whatsapp" size={20} color={WHATSAPP_GREEN} />
          </View>
          <Text weight="semibold" color={Colors.textPrimary} style={styles.actionLabel}>{t('locationSheet.requestOther')}</Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
        </TouchableOpacity>
      </View>
      {addresses.length > 0 && (
        <Text weight="semibold" color={Colors.textSecondary} style={styles.savedHeading}>
          {t('locationSheet.savedTitle')}
        </Text>
      )}
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={{ padding: Spacing.lg, gap: Spacing.md }}>
          {[0, 1, 2].map((k) => (
            <View key={k} style={styles.skeleton}>
              <Shimmer width={52} height={52} />
              <View style={{ flex: 1, gap: 8 }}>
                <Shimmer width="45%" height={16} />
                <Shimmer width="90%" height={14} />
                <Shimmer width="60%" height={12} />
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={addresses}
        keyExtractor={(a) => a.id}
        ListHeaderComponent={Header}
        renderItem={({ item }) => (
          <AddressCard
            address={item}
            userName={state.name}
            userPhone={state.phone}
            selected={item.isDefault}
            onSetDefault={() => void handleSetDefault(item)}
            onShare={() => void shareAddress(item)}
            onMore={() => setMenuFor(item)}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + Spacing.xxl }]}
        ListEmptyComponent={
          error ? (
            <View style={styles.center}>
              <Text style={styles.emoji}>😕</Text>
              <Text color={Colors.textSecondary}>{t('common.noInternet')}</Text>
            </View>
          ) : (
            <View style={styles.center}>
              <Text style={styles.emoji}>📍</Text>
              <Text weight="bold" color={Colors.textPrimary}>{t('address.noAddresses')}</Text>
              <Text color={Colors.textSecondary}>{t('address.noAddressesHint')}</Text>
            </View>
          )
        }
        showsVerticalScrollIndicator={false}
      />

      <AddressActionsSheet
        visible={!!menuFor}
        address={menuFor}
        onClose={() => setMenuFor(null)}
        onEdit={handleEdit}
        onShare={(a) => void shareAddress(a)}
        onSetDefault={(a) => void handleSetDefault(a)}
        onDelete={handleDelete}
      />
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    list:      { padding: Spacing.lg, gap: 0 },

    headerWrap: { marginBottom: Spacing.md },
    actionCard: {
      backgroundColor: Colors.surface, borderRadius: Radius.lg,
      borderWidth: 1, borderColor: Colors.border, ...Shadow.xs,
    },
    actionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, minHeight: 58 },
    actionIcon: { width: 38, height: 38, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
    actionLabel: { flex: 1, fontSize: FontSize.md },
    divider: { height: 1, backgroundColor: Colors.divider, marginLeft: 58 },

    savedHeading: { fontSize: FontSize.sm, marginTop: Spacing.lg },

    skeleton: {
      flexDirection: 'row', gap: Spacing.md, backgroundColor: Colors.surface,
      borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg,
    },

    center: { alignItems: 'center', gap: 8, paddingTop: 60, paddingHorizontal: 32 },
    emoji:  { fontSize: 56, lineHeight: 70 },
  });
