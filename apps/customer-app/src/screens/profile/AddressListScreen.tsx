import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, Alert,
  TextInput, Modal, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AddressResponse } from '@chirawa/types';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { FontSize, FontWeight, MIN_TAP, Radius, Shadow, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';
import { DotsLoader, Shimmer } from '../../components/ui';

type Props = NativeStackScreenProps<RootStackParamList, 'AddressList'>;

type LabelChoice = 'home' | 'work' | 'other';
const LABEL_VALUE: Record<LabelChoice, string> = { home: 'घर', work: 'दुकान', other: 'अन्य' };

const CHIRAWA_LAT     = 28.2330;
const CHIRAWA_LNG     = 75.6307;
const CHIRAWA_PINCODE = '333026';

function labelEmoji(label?: string | null): string {
  if (label === 'घर')   return '🏠';
  if (label === 'दुकान') return '🏪';
  return '📍';
}

export default function AddressListScreen({ navigation }: Props) {
  const t      = useT();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  const [addresses, setAddresses] = useState<AddressResponse[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(false);
  const [busyId,    setBusyId]    = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: t('address.title') });
  }, [navigation, t]);

  const load = useCallback(async () => {
    setError(false);
    try {
      const data = await api.getAddresses();
      // Default first
      data.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      setAddresses(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // Refresh when returning from the GPS address screen.
  useEffect(() => navigation.addListener('focus', () => { void load(); }), [navigation, load]);

  const handleRetry = useCallback(() => {
    setError(false);
    setLoading(true);
    void load();
  }, [load]);

  const handleSetDefault = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      await api.setDefaultAddress(id);
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.error');
      Alert.alert(t('common.error'), msg);
    } finally {
      setBusyId(null);
    }
  }, [load, t]);

  const handleDelete = useCallback((id: string) => {
    Alert.alert(t('address.deleteConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.confirm'), style: 'destructive',
        onPress: async () => {
          setBusyId(id);
          try {
            await api.deleteAddress(id);
            await load();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t('common.error');
            Alert.alert(t('common.error'), msg);
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  }, [load, t]);

  // ─── Render single card ───────────────────────────────────────────────────

  const renderCard = useCallback(({ item }: { item: AddressResponse }) => {
    const busy = busyId === item.id;
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.cardLabel} numberOfLines={1}>
            {labelEmoji(item.label)} {item.label ?? 'पता'}
          </Text>
          {item.isDefault && (
            <View style={styles.defaultBadge}>
              <Text style={styles.defaultBadgeText}>{t('address.defaultBadge')}</Text>
            </View>
          )}
        </View>
        <Text style={styles.cardStreet} numberOfLines={2}>{item.street}</Text>
        <Text style={styles.cardArea} numberOfLines={2}>
          {item.locality}{item.city ? `, ${item.city}` : ''} — {item.pincode}
        </Text>
        {item.landmark ? (
          <Text style={styles.cardLandmark} numberOfLines={1}>📌 {item.landmark}</Text>
        ) : null}

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleSetDefault(item.id)}
            disabled={item.isDefault || busy}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.actionStar}>{item.isDefault ? '⭐' : '☆'}</Text>
            <Text style={[styles.actionLabel, item.isDefault && styles.actionLabelDim]}>
              {item.isDefault ? t('address.defaultBadge') : t('address.setDefault')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleDelete(item.id)}
            disabled={busy}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.actionTrash}>🗑</Text>
            <Text style={[styles.actionLabel, styles.actionLabelDanger]}>
              {t('common.cancel') === 'Cancel' ? 'Delete' : 'हटाएं'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [busyId, t, handleSetDefault, handleDelete]);

  // ─── Render branches ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.listPad}>
          {[0, 1, 2].map((k) => (
            <View key={k} style={styles.card}>
              <Shimmer width="40%" height={16} />
              <View style={{ height: Spacing.sm }} />
              <Shimmer width="90%" height={14} />
              <View style={{ height: Spacing.xs }} />
              <Shimmer width="60%" height={12} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (error && addresses.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.centerBox}>
          <Text style={styles.bigEmoji}>😕</Text>
          <Text style={styles.bigTitle}>इंटरनेट नहीं है</Text>
          <Text style={styles.bigSub}>कनेक्शन चेक करें और दोबारा कोशिश करें</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleRetry} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>🔄 दोबारा कोशिश करें</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {addresses.length === 0 ? (
        <View style={styles.centerBox}>
          <Text style={styles.bigEmoji}>📍</Text>
          <Text style={styles.bigTitle}>{t('address.noAddresses')}</Text>
          <Text style={styles.bigSub}>{t('address.noAddressesHint')}</Text>
        </View>
      ) : (
        <FlatList
          data={addresses}
          keyExtractor={(item) => item.id}
          renderItem={renderCard}
          contentContainerStyle={[styles.listPad, { paddingBottom: 96 + insets.bottom }]}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        accessibilityLabel="Add address"
        onPress={() => navigation.navigate('AddressMap')}
        activeOpacity={0.85}
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
      >
        <Text style={styles.fabText}>＋</Text>
      </TouchableOpacity>

      <AddAddressModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => { setModalOpen(false); void load(); }}
      />
    </View>
  );
}

// ─── Add-address modal ───────────────────────────────────────────────────────

interface AddAddressModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function AddAddressModal({ visible, onClose, onSaved }: AddAddressModalProps) {
  const t      = useT();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const [label,    setLabel]    = useState<LabelChoice>('home');
  const [street,   setStreet]   = useState('');
  const [locality, setLocality] = useState('');
  const [landmark, setLandmark] = useState('');
  const [saving,   setSaving]   = useState(false);

  const reset = () => {
    setLabel('home'); setStreet(''); setLocality(''); setLandmark('');
  };

  const canSave = street.trim().length > 0 && locality.trim().length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await api.createAddress({
        label:    LABEL_VALUE[label],
        street:   street.trim(),
        landmark: landmark.trim() || '—',
        locality: locality.trim(),
        city:     'Chirawa',
        pincode:  CHIRAWA_PINCODE,
        lat:      CHIRAWA_LAT,
        lng:      CHIRAWA_LNG,
      });
      reset();
      onSaved();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.error');
      Alert.alert(t('common.error'), msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalSheet}
        >
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('address.addNew')}</Text>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {/* Label chips */}
              <View style={styles.chipRow}>
                {(['home', 'work', 'other'] as const).map((k) => {
                  const active = label === k;
                  const txt = k === 'home' ? t('address.labelHome')
                            : k === 'work' ? t('address.labelWork')
                            : t('address.labelOther');
                  return (
                    <TouchableOpacity
                      key={k}
                      onPress={() => setLabel(k)}
                      activeOpacity={0.85}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{txt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>{t('address.street')}</Text>
              <TextInput
                style={styles.input}
                value={street}
                onChangeText={setStreet}
                placeholder="e.g. 5, Nehru Nagar"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="words"
                returnKeyType="next"
              />

              <Text style={styles.fieldLabel}>{t('address.area')}</Text>
              <TextInput
                style={styles.input}
                value={locality}
                onChangeText={setLocality}
                placeholder="e.g. Purani Basti"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="words"
                returnKeyType="next"
              />

              <Text style={styles.fieldLabel}>{t('address.landmark')}</Text>
              <TextInput
                style={styles.input}
                value={landmark}
                onChangeText={setLandmark}
                placeholder="मंदिर के पास"
                placeholderTextColor={Colors.textMuted}
                returnKeyType="done"
              />
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={onClose}
                disabled={saving}
                activeOpacity={0.7}
                style={[styles.modalBtn, styles.modalBtnGhost]}
              >
                <Text style={styles.modalBtnGhostText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void handleSave()}
                disabled={!canSave}
                activeOpacity={0.85}
                style={[styles.modalBtn, styles.modalBtnPrimary, !canSave && styles.modalBtnDisabled]}
              >
                {saving ? (
                  <DotsLoader color={Colors.white} size={8} />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>{t('address.save')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  listPad:   { padding: Spacing.lg },

  // Card
  card: {
    backgroundColor: Colors.surface,
    borderRadius:    Radius.lg,
    padding:         Spacing.lg,
    gap:             4,
    ...Shadow.sm,
  },
  cardTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 2,
  },
  cardLabel: {
    fontSize:   FontSize.sm,
    fontWeight: FontWeight.bold,
    color:      Colors.textPrimary,
  },
  defaultBadge: {
    backgroundColor:   Colors.successLight,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderRadius:      Radius.full,
  },
  defaultBadgeText: {
    color:      Colors.success,
    fontSize:   FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  cardStreet:   { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textPrimary, marginTop: 4 },
  cardArea:     { fontSize: FontSize.sm, color: Colors.textSecondary },
  cardLandmark: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: 2 },

  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.lg,
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  actionBtn: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            6,
    minHeight:      MIN_TAP,
    paddingHorizontal: Spacing.sm,
  },
  actionStar:  { fontSize: 18 },
  actionTrash: { fontSize: 18 },
  actionLabel: {
    fontSize:   FontSize.sm,
    fontWeight: FontWeight.semibold,
    color:      Colors.textPrimary,
  },
  actionLabelDim:    { color: Colors.success },
  actionLabelDanger: { color: Colors.error },

  // Empty / error center
  centerBox: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 32, gap: 12,
  },
  bigEmoji: { fontSize: 64, lineHeight: 90, includeFontPadding: false },
  bigTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary, textAlign: 'center' },
  bigSub:   { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center' },
  primaryBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.full,
    paddingHorizontal: 32, paddingVertical: 14, marginTop: 8,
    minHeight: MIN_TAP, justifyContent: 'center', alignItems: 'center',
  },
  primaryBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: FontWeight.bold },

  // FAB
  fab: {
    position:        'absolute',
    right:           20,
    width:           56,
    height:          56,
    borderRadius:    Radius.full,
    backgroundColor: Colors.primary,
    justifyContent:  'center',
    alignItems:      'center',
    ...Shadow.primary,
  },
  fabText: { color: Colors.white, fontSize: FontSize.xxl, fontWeight: FontWeight.bold, lineHeight: 28 },

  // Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet:    { },
  modalCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius:  Radius.xl,
    borderTopRightRadius: Radius.xl,
    padding: Spacing.lg,
    gap:     Spacing.md,
    maxHeight: '90%',
  },
  modalHandle: {
    alignSelf: 'center',
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    marginBottom: 4,
  },
  modalTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },

  chipRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   8,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       Colors.border,
    backgroundColor:   Colors.surface,
  },
  chipActive: {
    borderColor:     Colors.primary,
    backgroundColor: Colors.primary,
  },
  chipText:       { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: FontWeight.semibold },
  chipTextActive: { color: Colors.white },

  fieldLabel: {
    fontSize: FontSize.sm, fontWeight: FontWeight.semibold,
    color: Colors.textSecondary, marginTop: Spacing.sm, marginBottom: 4,
  },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, height: 48,
    fontSize: FontSize.md, color: Colors.textPrimary,
    backgroundColor: Colors.surface,
  },

  modalActions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.md },
  modalBtn:     { flex: 1, minHeight: MIN_TAP, justifyContent: 'center', alignItems: 'center', borderRadius: Radius.md },
  modalBtnGhost:       { borderWidth: 1.5, borderColor: Colors.border },
  modalBtnGhostText:   { color: Colors.textPrimary, fontWeight: FontWeight.semibold, fontSize: FontSize.md },
  modalBtnPrimary:     { backgroundColor: Colors.primary },
  modalBtnPrimaryText: { color: Colors.white, fontWeight: FontWeight.bold, fontSize: FontSize.md },
  modalBtnDisabled:    { opacity: 0.5 },
});
