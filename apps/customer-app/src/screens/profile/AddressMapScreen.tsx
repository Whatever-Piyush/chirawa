import React, { useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import * as Location from 'expo-location';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { FontSize, MIN_TAP, Radius, Shadow, Spacing } from '../../theme';
import { useT } from '@chirawa/i18n';
import { api } from '../../services/api.service';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'AddressMap'> };

const CHIRAWA = { lat: 28.2330, lng: 75.6307 };
const PINCODE = '333026';
const MAX_KM  = 5; // delivery boundary from town centre

type LabelChoice = 'home' | 'work' | 'other';
const LABEL_VALUE: Record<LabelChoice, string> = { home: 'घर', work: 'दुकान', other: 'अन्य' };

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export default function AddressMapScreen({ navigation }: Props) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const mapRef = useRef<MapView | null>(null);

  const [pin, setPin]       = useState({ lat: CHIRAWA.lat, lng: CHIRAWA.lng });
  const [locating, setLocating] = useState(false);
  const [label, setLabel]   = useState<LabelChoice>('home');
  const [house, setHouse]   = useState('');
  const [landmark, setLandmark] = useState('');
  const [area, setArea]     = useState('');
  const [saving, setSaving] = useState(false);

  const outside = distanceKm(pin, CHIRAWA) > MAX_KM;
  const canSave = house.trim().length > 0 && area.trim().length > 0 && !outside && !saving;

  async function useCurrentLocation() {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Bringly', t('address.locationDenied')); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const next = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      setPin(next);
      mapRef.current?.animateToRegion({ latitude: next.lat, longitude: next.lng, latitudeDelta: 0.006, longitudeDelta: 0.006 }, 600);
    } catch {
      Alert.alert('Bringly', t('address.locationDenied'));
    } finally {
      setLocating(false);
    }
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await api.createAddress({
        label:    LABEL_VALUE[label],
        street:   house.trim(),
        landmark: landmark.trim() || area.trim(),
        locality: area.trim(),
        city:     'Chirawa',
        pincode:  PINCODE,
        lat:      pin.lat,
        lng:      pin.lng,
      });
      navigation.goBack();
    } catch (err: unknown) {
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('common.retry'));
    } finally {
      setSaving(false);
    }
  }

  const region: Region = { latitude: pin.lat, longitude: pin.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.mapWrap}>
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            initialRegion={region}
          >
            <Marker
              coordinate={{ latitude: pin.lat, longitude: pin.lng }}
              draggable
              onDragEnd={(e) => setPin({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}
            >
              <View style={styles.pin}><Text style={styles.pinEmoji}>📍</Text></View>
            </Marker>
          </MapView>
          <View style={styles.dragHint}><Text style={styles.dragHintText}>{t('address.dragToAdjust')}</Text></View>
        </View>

        <TouchableOpacity style={styles.locBtn} onPress={() => void useCurrentLocation()} disabled={locating} activeOpacity={0.85}>
          {locating ? <ActivityIndicator color={Colors.primary} /> : <Text style={styles.locBtnText}>{t('address.useMyLocation')}</Text>}
        </TouchableOpacity>

        {outside && <Text style={styles.outside}>⚠️ {t('address.outsideChirawa')}</Text>}

        <View style={styles.chipRow}>
          {(['home', 'work', 'other'] as const).map((k) => {
            const active = label === k;
            const txt = k === 'home' ? t('address.labelHome') : k === 'work' ? t('address.labelWork') : t('address.labelOther');
            return (
              <TouchableOpacity key={k} onPress={() => setLabel(k)} style={[styles.chip, active && styles.chipActive]} activeOpacity={0.85}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{txt}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Field label={t('address.houseNo')} value={house} onChange={setHouse} styles={styles} colors={Colors} />
        <Field label={t('address.landmark')} value={landmark} onChange={setLandmark} styles={styles} colors={Colors} />
        <Field label={t('address.area')} value={area} onChange={setArea} styles={styles} colors={Colors} />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
        <TouchableOpacity style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]} onPress={() => void handleSave()} disabled={!canSave} activeOpacity={0.9}>
          {saving ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.saveBtnText}>{t('address.save')}</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function Field({ label, value, onChange, styles, colors }: {
  label: string; value: string; onChange: (s: string) => void;
  styles: ReturnType<typeof makeStyles>; colors: ColorPalette;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={onChange} placeholderTextColor={colors.textMuted} returnKeyType="done" />
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    flex:   { flex: 1, backgroundColor: Colors.background },
    scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 120 },
    mapWrap: { height: 280, borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: Colors.surface },
    pin:      { alignItems: 'center', justifyContent: 'center' },
    pinEmoji: { fontSize: 34, lineHeight: 38 },
    dragHint: { position: 'absolute', top: Spacing.sm, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: Radius.full, paddingHorizontal: Spacing.md, paddingVertical: 4 },
    dragHintText: { color: '#fff', fontSize: FontSize.xs, fontWeight: '700' },
    locBtn: { borderWidth: 1.5, borderColor: Colors.primary, borderRadius: Radius.md, paddingVertical: Spacing.md, alignItems: 'center', backgroundColor: Colors.primaryLight },
    locBtnText: { color: Colors.primary, fontWeight: '800', fontSize: FontSize.md },
    outside: { color: Colors.error, fontWeight: '700', fontSize: FontSize.sm, textAlign: 'center' },
    chipRow: { flexDirection: 'row', gap: Spacing.sm },
    chip: { paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
    chipActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
    chipText: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '700' },
    chipTextActive: { color: Colors.white },
    field: { gap: 4 },
    fieldLabel: { fontSize: FontSize.sm, color: Colors.textLight, fontWeight: '700' },
    input: { borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md, height: 50, fontSize: FontSize.md, color: Colors.text, backgroundColor: Colors.surface },
    footer: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.card, borderTopWidth: 1, borderTopColor: Colors.border, padding: Spacing.lg },
    saveBtn: { backgroundColor: Colors.primary, borderRadius: Radius.lg, height: 54, alignItems: 'center', justifyContent: 'center', ...Shadow.primary },
    saveBtnDisabled: { opacity: 0.5 },
    saveBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '900' },
  });
