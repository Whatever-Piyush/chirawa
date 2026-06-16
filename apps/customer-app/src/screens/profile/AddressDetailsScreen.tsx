import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
// Type-only: the import is erased at runtime so the native module is NOT loaded
// when this screen mounts. expo-contacts is required lazily on tap (see
// pickFromContacts) so an older dev build without the module can't crash the app.
import type * as ContactsModule from 'expo-contacts';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ContactType } from '@chirawa/types';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { FontSize, FontWeight, Radius, Shadow, Spacing } from '../../theme';
import { useT } from '@chirawa/i18n';
import { api } from '../../services/api.service';
import { useAuth } from '../../context/AuthContext';
import { reverseGeocode } from '../../utils/geocode';

type Props = NativeStackScreenProps<RootStackParamList, 'AddressDetails'>;

type LabelChoice = 'home' | 'work' | 'hotel' | 'other';
const LABEL_VALUE: Record<LabelChoice, string> = {
  home: 'घर', work: 'दुकान', hotel: 'होटल', other: 'अन्य',
};
const LABEL_ICON: Record<LabelChoice, React.ComponentProps<typeof Ionicons>['name']> = {
  home: 'home-outline', work: 'briefcase-outline', hotel: 'bed-outline', other: 'people-outline',
};

// Keep the last 10 digits of whatever the picker / user hands us.
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export default function AddressDetailsScreen({ route, navigation }: Props) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const { state } = useAuth();

  // Resolved location (City / Area + coords) — starts from the map pin's params,
  // but the "enable to auto-fill" banner can replace it with the live location.
  const [resolved, setResolved] = useState({
    lat:      route.params.lat,
    lng:      route.params.lng,
    title:    route.params.title,
    subtitle: route.params.subtitle,
    locality: route.params.locality,
    city:     route.params.city,
    pincode:  route.params.pincode,
  });

  // Location-off banner (#8): shown when foreground permission isn't granted.
  const [locOff, setLocOff]   = useState(false);
  const [enabling, setEnabling] = useState(false);

  // Address boxes
  const [house, setHouse]       = useState('');
  const [areaStreet, setAreaStreet] = useState('');
  const [landmark, setLandmark] = useState('');
  const [mapsLink, setMapsLink] = useState('');

  // Contact details
  const [contactType, setContactType] = useState<ContactType>('myself');
  const [receiverName, setReceiverName]   = useState(state.name ?? '');
  const [receiverPhone, setReceiverPhone] = useState(state.phone ? normalizePhone(state.phone) : '');

  const [label, setLabel]   = useState<LabelChoice>('home');
  const [saving, setSaving] = useState(false);

  // v3: House/Apartment optional; Area + Landmark required.
  const canSave =
    areaStreet.trim().length > 0 &&
    landmark.trim().length > 0 &&
    receiverName.trim().length > 0 &&
    receiverPhone.trim().length === 10 &&
    !saving;

  // Show the auto-fill banner only while location permission is missing.
  useEffect(() => {
    let active = true;
    Location.getForegroundPermissionsAsync()
      .then(({ granted }) => { if (active) setLocOff(!granted); })
      .catch(() => { /* tolerate */ });
    return () => { active = false; };
  }, []);

  async function enableAndAutofill() {
    setEnabling(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        void Linking.openSettings();
        return;
      }
      setLocOff(false);
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      const r = await reverseGeocode(loc.coords.latitude, loc.coords.longitude);
      setResolved({
        lat: loc.coords.latitude, lng: loc.coords.longitude,
        title: r.title, subtitle: r.subtitle, locality: r.locality, city: r.city, pincode: r.pincode,
      });
    } catch {
      /* tolerate — fields stay manual */
    } finally {
      setEnabling(false);
    }
  }

  function chooseContactType(next: ContactType) {
    setContactType(next);
    if (next === 'myself') {
      setReceiverName(state.name ?? '');
      setReceiverPhone(state.phone ? normalizePhone(state.phone) : '');
    } else {
      setReceiverName('');
      setReceiverPhone('');
    }
  }

  async function pickFromContacts() {
    // Lazily load the native module. If this dev build predates expo-contacts the
    // require throws — caught here so the field stays usable (type manually).
    let Contacts: typeof ContactsModule;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      Contacts = require('expo-contacts') as typeof ContactsModule;
    } catch {
      Alert.alert('Bringly', t('address.contactsUnavailable'));
      return;
    }
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') return;
      const contact = await Contacts.presentContactPickerAsync();
      if (!contact) return;
      if (contact.name) setReceiverName(contact.name);
      const phone = contact.phoneNumbers?.[0]?.number;
      if (phone) setReceiverPhone(normalizePhone(phone));
      setContactType('other');
    } catch {
      /* tolerate — user can type manually */
    }
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      // House is optional; Area is required so `street` is always non-empty.
      const street = [house.trim(), areaStreet.trim()].filter(Boolean).join(', ');
      await api.createAddress({
        label:    LABEL_VALUE[label],
        street,
        landmark: landmark.trim(),
        locality: resolved.locality,
        city:     resolved.city,
        pincode:  resolved.pincode,
        lat:      resolved.lat,
        lng:      resolved.lng,
        contactType,
        receiverName:  receiverName.trim(),
        receiverPhone: receiverPhone.trim(),
        mapsLink: mapsLink.trim() || undefined,
      });
      navigation.navigate('AddressList');
    } catch (err: unknown) {
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('common.retry'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* ── Location-off banner (#8): enable to auto-fill ── */}
        {locOff && (
          <View style={styles.banner}>
            <Ionicons name="location-outline" size={26} color={Colors.error} style={styles.bannerIcon} />
            <View style={styles.bannerText}>
              <Text style={styles.bannerTitle}>{t('address.autoFillTitle')}</Text>
              <Text style={styles.bannerBody}>{t('address.autoFillBody')}</Text>
            </View>
            <TouchableOpacity style={styles.bannerBtn} onPress={() => void enableAndAutofill()} disabled={enabling} activeOpacity={0.85}>
              {enabling
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <Text style={styles.bannerBtnText}>{t('address.enable')}</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* ── Address details card ── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('address.detailsTitle')}</Text>

          {/* City row */}
          <SummaryRow
            icon="business-outline"
            label={t('address.cityLabel')}
            value={resolved.city}
            changeLabel={t('address.change')}
            onChange={() => navigation.goBack()}
            styles={styles} Colors={Colors}
          />
          {/* Area, street row — real geocoded area name */}
          <SummaryRow
            icon="location-outline"
            label={t('address.areaStreetLabel')}
            value={resolved.title || resolved.locality}
            sub={resolved.subtitle}
            changeLabel={t('address.change')}
            onChange={() => navigation.goBack()}
            styles={styles} Colors={Colors}
          />

          {/* 3 address boxes, each with an example hint */}
          <BoxField
            placeholder={t('address.boxHouse')} example={t('address.boxHouseEg')}
            value={house} onChange={setHouse} styles={styles} colors={Colors} autoFocus
          />
          <BoxField
            placeholder={t('address.boxAreaStreet')} example={t('address.boxAreaStreetEg')}
            value={areaStreet} onChange={setAreaStreet} styles={styles} colors={Colors}
          />
          <BoxField
            placeholder={t('address.boxLandmark')} example={t('address.boxLandmarkEg')}
            value={landmark} onChange={setLandmark} styles={styles} colors={Colors}
          />

          {/* Optional Google Maps link */}
          <View style={styles.mapsRow}>
            <Ionicons name="map-outline" size={18} color={Colors.primary} />
            <TextInput
              style={styles.mapsInput}
              value={mapsLink}
              onChangeText={setMapsLink}
              placeholder={t('address.mapsLink')}
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none" autoCorrect={false} keyboardType="url"
            />
          </View>
        </View>

        {/* ── Contact details card ── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('address.contactDetails')}</Text>

          <View style={styles.radioRow}>
            <RadioOption
              label={t('address.myself')} selected={contactType === 'myself'}
              onPress={() => chooseContactType('myself')} styles={styles} Colors={Colors}
            />
            <RadioOption
              label={t('address.someoneElse')} selected={contactType === 'other'}
              onPress={() => chooseContactType('other')} styles={styles} Colors={Colors}
            />
          </View>

          {/* Receiver name (clearable) */}
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.inputFlex}
              value={receiverName}
              onChangeText={setReceiverName}
              placeholder={t('address.receiverName')}
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="words"
            />
            {receiverName.length > 0 && (
              <TouchableOpacity onPress={() => setReceiverName('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={18} color={Colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Receiver phone with +91 + contacts picker */}
          <View style={styles.inputWrap}>
            <Text style={styles.phonePrefix}>+91</Text>
            <View style={styles.phoneDivider} />
            <TextInput
              style={styles.inputFlex}
              value={receiverPhone}
              onChangeText={(v) => setReceiverPhone(normalizePhone(v))}
              placeholder={t('address.receiverPhone')}
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad" maxLength={10}
            />
            <TouchableOpacity onPress={() => void pickFromContacts()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="person-circle-outline" size={22} color={Colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Save address as ── */}
        <Text style={styles.saveAsLabel}>{t('address.saveAs')}</Text>
        <View style={styles.chipRow}>
          {(['home', 'work', 'hotel', 'other'] as const).map((k) => {
            const active = label === k;
            const txt =
              k === 'home'  ? t('address.typeHome')  :
              k === 'work'  ? t('address.typeWork')  :
              k === 'hotel' ? t('address.typeHotel') : t('address.typeOther');
            return (
              <TouchableOpacity
                key={k}
                onPress={() => setLabel(k)}
                style={[styles.chip, active && styles.chipActive]}
                activeOpacity={0.85}
              >
                <Ionicons name={LABEL_ICON[k]} size={15} color={active ? Colors.primary : Colors.textSecondary} />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{txt}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
        <TouchableOpacity
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={() => void handleSave()}
          disabled={!canSave}
          activeOpacity={0.9}
        >
          {saving ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.saveBtnText}>{t('address.save')}</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SummaryRow({ icon, label, value, sub, changeLabel, onChange, styles, Colors }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string; value: string; sub?: string; changeLabel: string; onChange: () => void;
  styles: ReturnType<typeof makeStyles>; Colors: ColorPalette;
}) {
  return (
    <View style={styles.summaryRow}>
      <View style={styles.summaryIcon}><Ionicons name={icon} size={20} color={Colors.primary} /></View>
      <View style={styles.summaryText}>
        <Text style={styles.summaryLabel}>{label}</Text>
        <Text style={styles.summaryValue} numberOfLines={1}>{value}</Text>
        {sub ? <Text style={styles.summarySub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      <TouchableOpacity style={styles.changeBtn} onPress={onChange} activeOpacity={0.7}>
        <Text style={styles.changeBtnText}>{changeLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

function BoxField({ placeholder, example, value, onChange, styles, colors, autoFocus }: {
  placeholder: string; example: string; value: string; onChange: (s: string) => void;
  styles: ReturnType<typeof makeStyles>; colors: ColorPalette; autoFocus?: boolean;
}) {
  return (
    <View style={styles.boxWrap}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoFocus={autoFocus}
        returnKeyType="next"
      />
      <Text style={styles.exampleText}>{example}</Text>
    </View>
  );
}

function RadioOption({ label, selected, onPress, styles, Colors }: {
  label: string; selected: boolean; onPress: () => void;
  styles: ReturnType<typeof makeStyles>; Colors: ColorPalette;
}) {
  return (
    <TouchableOpacity style={styles.radioOption} onPress={onPress} activeOpacity={0.7}>
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={20} color={selected ? Colors.primary : Colors.textTertiary}
      />
      <Text style={[styles.radioText, selected && styles.radioTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    flex:   { flex: 1, backgroundColor: Colors.background },
    scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: 120 },

    // Location-off banner (#8)
    banner: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
      backgroundColor: Colors.errorLight, borderRadius: Radius.lg,
      padding: Spacing.md,
    },
    bannerIcon:  { marginHorizontal: 2 },
    bannerText:  { flex: 1 },
    bannerTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.textPrimary },
    bannerBody:  { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },
    bannerBtn: {
      backgroundColor: Colors.primary, borderRadius: Radius.md,
      paddingHorizontal: Spacing.lg, paddingVertical: 8, minWidth: 72, alignItems: 'center',
    },
    bannerBtnText: { color: Colors.white, fontWeight: FontWeight.bold, fontSize: FontSize.sm },

    card: {
      backgroundColor: Colors.surface,
      borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
      padding: Spacing.lg, gap: Spacing.md,
      ...Shadow.xs,
    },
    cardTitle: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.textPrimary },

    // Summary (City / Area) rows
    summaryRow: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
      borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
      padding: Spacing.md,
    },
    summaryIcon: {
      width: 40, height: 40, borderRadius: Radius.sm,
      backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center',
    },
    summaryText:  { flex: 1 },
    summaryLabel: { fontSize: FontSize.xs, color: Colors.textSecondary },
    summaryValue: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.textPrimary },
    summarySub:   { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },
    changeBtn: {
      borderWidth: 1, borderColor: Colors.primary, borderRadius: Radius.sm,
      paddingHorizontal: Spacing.md, paddingVertical: 6,
    },
    changeBtnText: { color: Colors.primary, fontWeight: FontWeight.bold, fontSize: FontSize.sm },

    // 3 boxes
    boxWrap: { gap: 4 },
    input: {
      borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
      paddingHorizontal: Spacing.md, height: 52,
      fontSize: FontSize.md, color: Colors.textPrimary, backgroundColor: Colors.surface,
    },
    exampleText: { fontSize: FontSize.xs, color: Colors.textTertiary, marginLeft: 4 },

    // Maps link
    mapsRow: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
      borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
      paddingHorizontal: Spacing.md, height: 52,
    },
    mapsInput: { flex: 1, fontSize: FontSize.md, color: Colors.textPrimary, padding: 0 },

    // Contact details
    radioRow: { flexDirection: 'row', gap: Spacing.xxl },
    radioOption: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    radioText:       { fontSize: FontSize.md, color: Colors.textSecondary, fontWeight: FontWeight.semibold },
    radioTextActive: { color: Colors.textPrimary },

    inputWrap: {
      flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
      borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
      paddingHorizontal: Spacing.md, height: 52,
    },
    inputFlex:    { flex: 1, fontSize: FontSize.md, color: Colors.textPrimary, padding: 0 },
    phonePrefix:  { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.textPrimary },
    phoneDivider: { width: 1, height: 22, backgroundColor: Colors.border },

    // Save as chips
    saveAsLabel: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.textPrimary },
    chipRow: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: Spacing.md, paddingVertical: 9,
      borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface,
    },
    chipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
    chipText:       { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: FontWeight.semibold },
    chipTextActive: { color: Colors.primary },

    footer: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border,
      padding: Spacing.lg,
    },
    saveBtn: {
      backgroundColor: Colors.primary, borderRadius: Radius.lg, height: 54,
      alignItems: 'center', justifyContent: 'center', ...Shadow.primary,
    },
    saveBtnDisabled: { backgroundColor: Colors.disabled, ...Shadow.none },
    saveBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: FontWeight.heavy },
  });
