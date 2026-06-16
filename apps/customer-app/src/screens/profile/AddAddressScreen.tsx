import React, { useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { FontSize, MIN_TAP, Radius, Shadow, Spacing } from '../../theme';
import { useT } from '@chirawa/i18n';
import { api } from '../../services/api.service';
import { resolveCurrentAddress } from '../../utils/location';

// Blinkit-style "Add address details" page (ss/2.jpeg), Chirawa-skinned. Chirawa
// is a single delivery town, so City is read-only; Area + House fill the address,
// and an optional "Someone else" receiver is carried back to Checkout to attach
// to the order. Lat/lng default to the town centre and refine if GPS is enabled.
type Props = NativeStackScreenProps<RootStackParamList, 'AddAddress'>;

const CHIRAWA  = { lat: 28.2330, lng: 75.6307 };
const PINCODE  = '333026';
const CITY     = 'Chirawa';

type LabelChoice = 'home' | 'work' | 'other';
const LABEL_VALUE: Record<LabelChoice, string> = { home: 'घर', work: 'दुकान', other: 'अन्य' };

export default function AddAddressScreen({ navigation, route }: Props) {
  const t      = useT();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const returnTo = route.params?.returnTo;

  const [area,     setArea]     = useState('');
  const [house,    setHouse]    = useState('');
  const [landmark, setLandmark] = useState('');
  const [label,    setLabel]    = useState<LabelChoice>('home');
  const [coords,   setCoords]   = useState(CHIRAWA);
  const [locOn,    setLocOn]    = useState(false);
  const [locating, setLocating] = useState(false);

  // Contact details — "Myself" (the logged-in user) or "Someone else".
  const [forSelf,       setForSelf]       = useState(true);
  const [receiverName,  setReceiverName]  = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');

  const [saving, setSaving] = useState(false);

  const receiverValid = receiverName.trim().length >= 2 && receiverPhone.trim().length >= 10;
  const canSave =
    house.trim().length > 0 && area.trim().length > 0 &&
    (forSelf || receiverValid) && !saving;

  // Enable GPS → resolve a real, Plus-Code-free address (Google via our backend,
  // on-device fallback) and prefill Area (+ House from the street when empty).
  async function enableLocation() {
    setLocating(true);
    try {
      const res = await resolveCurrentAddress();
      if (!res.ok) { Alert.alert('Bringly', t('address.locationDenied')); return; }
      const a = res.address;
      setCoords({ lat: a.lat, lng: a.lng });
      setLocOn(true);
      if (a.area   && !area.trim())  setArea(a.area);
      if (a.street && !house.trim()) setHouse(a.street);
    } finally {
      setLocating(false);
    }
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const addr = await api.createAddress({
        label:    LABEL_VALUE[label],
        street:   house.trim(),
        landmark: landmark.trim() || area.trim(),
        locality: area.trim(),
        city:     CITY,
        pincode:  PINCODE,
        lat:      coords.lat,
        lng:      coords.lng,
        isDefault: true,   // auto-select it on whichever screen we return to
      });
      if (returnTo === 'Checkout') {
        navigation.navigate('Checkout', {
          newAddressId: addr.id,
          ...(forSelf ? {} : { receiverName: receiverName.trim(), receiverPhone: receiverPhone.trim() }),
        });
      } else {
        navigation.goBack();
      }
    } catch (err: unknown) {
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('common.retry'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Enable-location banner */}
        <View style={styles.locBanner}>
          <View style={styles.locBannerIcon}>
            <Ionicons name="navigate-circle-outline" size={26} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.locBannerTitle}>{t('address.enableLocTitle')}</Text>
            <Text style={styles.locBannerSub}>
              {locOn ? t('address.useMyLocation') : t('address.enableLocSub')}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.enableBtn, locOn && styles.enableBtnOn]}
            onPress={() => void enableLocation()}
            disabled={locating || locOn}
            activeOpacity={0.85}
          >
            {locating
              ? <ActivityIndicator color={Colors.white} size="small" />
              : <Text style={styles.enableBtnText}>{locOn ? '✓' : t('address.enable')}</Text>}
          </TouchableOpacity>
        </View>

        {/* ── Address details ─────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('address.detailsCard')}</Text>

          {/* City — read-only (single-town Chirawa) */}
          <View style={styles.detailRow}>
            <View style={styles.detailIcon}>
              <Ionicons name="business-outline" size={20} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.detailLabel}>{t('address.cityLabel')}</Text>
              <Text style={styles.detailValue}>{CITY}</Text>
            </View>
            <View style={styles.lockedPill}>
              <Ionicons name="lock-closed" size={11} color={Colors.textTertiary} />
            </View>
          </View>

          {/* Area / street */}
          <Text style={styles.fieldLabel}>{t('address.areaStreet')}</Text>
          <TextInput
            style={styles.input}
            value={area}
            onChangeText={setArea}
            placeholder={t('checkout.areaPlaceholder')}
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="words"
            returnKeyType="next"
          />

          {/* House / Flat */}
          <TextInput
            style={[styles.input, { marginTop: Spacing.md }]}
            value={house}
            onChangeText={setHouse}
            placeholder={t('address.houseNoPh')}
            placeholderTextColor={Colors.textMuted}
            returnKeyType="next"
          />

          {/* Landmark (optional) */}
          <TextInput
            style={[styles.input, { marginTop: Spacing.md }]}
            value={landmark}
            onChangeText={setLandmark}
            placeholder={t('address.landmark')}
            placeholderTextColor={Colors.textMuted}
            returnKeyType="done"
          />

          {/* Save-as label chips */}
          <View style={styles.chipRow}>
            {(['home', 'work', 'other'] as const).map((k) => {
              const active = label === k;
              const txt = k === 'home' ? t('address.labelHome') : k === 'work' ? t('address.labelWork') : t('address.labelOther');
              return (
                <TouchableOpacity key={k} onPress={() => setLabel(k)} activeOpacity={0.85} style={[styles.chip, active && styles.chipActive]}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{txt}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Contact details ─────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('address.contactDetails')}</Text>

          <View style={styles.contactToggle}>
            <TouchableOpacity style={styles.radioRow} activeOpacity={0.8} onPress={() => setForSelf(true)}>
              <View style={[styles.radio, forSelf && styles.radioOn]}>{forSelf && <View style={styles.radioDot} />}</View>
              <Text style={[styles.radioLabel, forSelf && styles.radioLabelOn]}>{t('address.myself')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.radioRow} activeOpacity={0.8} onPress={() => setForSelf(false)}>
              <View style={[styles.radio, !forSelf && styles.radioOn]}>{!forSelf && <View style={styles.radioDot} />}</View>
              <Text style={[styles.radioLabel, !forSelf && styles.radioLabelOn]}>{t('address.someoneElse')}</Text>
            </TouchableOpacity>
          </View>

          {!forSelf && (
            <>
              <TextInput
                style={[styles.input, { marginTop: Spacing.md }]}
                value={receiverName}
                onChangeText={setReceiverName}
                placeholder={t('address.receiverName')}
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="words"
                returnKeyType="next"
              />
              <TextInput
                style={[styles.input, { marginTop: Spacing.md }]}
                value={receiverPhone}
                onChangeText={(v) => setReceiverPhone(v.replace(/[^0-9]/g, '').slice(0, 10))}
                placeholder={t('address.receiverPhone')}
                placeholderTextColor={Colors.textMuted}
                keyboardType="phone-pad"
                returnKeyType="done"
              />
            </>
          )}
        </View>
      </ScrollView>

      {/* Sticky Save / Next */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
        <TouchableOpacity
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={() => void handleSave()}
          disabled={!canSave}
          activeOpacity={0.9}
        >
          {saving ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.saveBtnText}>{t('address.next')}</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    flex:   { flex: 1, backgroundColor: Colors.background },
    scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: 140 },

    // Enable-location banner
    locBanner: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
      backgroundColor: Colors.primaryLight, borderRadius: Radius.lg, padding: Spacing.md,
      borderWidth: 1, borderColor: 'rgba(255,107,53,0.16)',
    },
    locBannerIcon: {
      width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.white,
      alignItems: 'center', justifyContent: 'center', ...Shadow.xs,
    },
    locBannerTitle: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.textPrimary },
    locBannerSub:   { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
    enableBtn: {
      backgroundColor: Colors.primary, borderRadius: Radius.full,
      paddingHorizontal: Spacing.lg, height: 36, minWidth: 64,
      alignItems: 'center', justifyContent: 'center',
    },
    enableBtnOn:   { backgroundColor: Colors.success },
    enableBtnText: { color: Colors.white, fontWeight: '800', fontSize: FontSize.sm },

    // Cards
    card: {
      backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.lg,
      gap: Spacing.md, borderWidth: 1, borderColor: 'rgba(0,0,0,0.04)', ...Shadow.sm,
    },
    cardTitle: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.3 },

    detailRow: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
      borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, padding: Spacing.md,
    },
    detailIcon: {
      width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.primaryLight,
      alignItems: 'center', justifyContent: 'center',
    },
    detailLabel: { fontSize: FontSize.xs, color: Colors.textSecondary },
    detailValue: { fontSize: FontSize.md, fontWeight: '800', color: Colors.textPrimary, marginTop: 1 },
    lockedPill: {
      width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.surfaceAlt,
      alignItems: 'center', justifyContent: 'center',
    },

    fieldLabel: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textLight, marginTop: 2 },
    input: {
      borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
      paddingHorizontal: Spacing.md, height: 52, fontSize: FontSize.md,
      color: Colors.text, backgroundColor: Colors.surface,
    },

    chipRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: 2 },
    chip: {
      paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.full,
      borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
    },
    chipActive:     { borderColor: Colors.primary, backgroundColor: Colors.primary },
    chipText:       { fontSize: FontSize.sm, color: Colors.text, fontWeight: '700' },
    chipTextActive: { color: Colors.white },

    // Contact toggle
    contactToggle: { flexDirection: 'row', gap: Spacing.xl },
    radioRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    radio: {
      width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.border,
      alignItems: 'center', justifyContent: 'center',
    },
    radioOn:  { borderColor: Colors.primary },
    radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: Colors.primary },
    radioLabel:   { fontSize: FontSize.md, color: Colors.textSecondary, fontWeight: '700' },
    radioLabelOn: { color: Colors.textPrimary },

    // Sticky footer
    footer: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      backgroundColor: Colors.card, borderTopWidth: 1, borderTopColor: Colors.border, padding: Spacing.lg,
    },
    saveBtn: {
      backgroundColor: Colors.primary, borderRadius: Radius.lg, height: 54,
      alignItems: 'center', justifyContent: 'center', minHeight: MIN_TAP, ...Shadow.primary,
    },
    saveBtnDisabled: { opacity: 0.5 },
    saveBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '900' },
  });
