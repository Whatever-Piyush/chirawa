import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { FontSize, FontWeight, Radius, Shadow, Spacing } from '../../theme';
import { useT } from '@chirawa/i18n';
import { CHIRAWA_CENTER, distanceKm, isInsideServiceArea } from '../../utils/geo';
import { reverseGeocode, type ResolvedAddress } from '../../utils/geocode';

type Props = NativeStackScreenProps<RootStackParamList, 'AddressMap'>;

const PINCODE = '333026';
const SNAP_KM = 0.03;  // ≤30 m → treat the map centre as the exact GPS fix

type LatLng = { lat: number; lng: number };

function fallbackResolved(label: string): ResolvedAddress {
  return { title: label, subtitle: label, locality: 'Chirawa', city: 'Chirawa', pincode: PINCODE };
}

export default function AddressMapScreen({ navigation, route }: Props) {
  const t = useT();
  const autoLocate = route.params?.autoLocate ?? false;
  const insets = useSafeAreaInsets();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const mapRef = useRef<MapView | null>(null);

  const [pin, setPin]             = useState<LatLng>({ lat: CHIRAWA_CENTER.lat, lng: CHIRAWA_CENTER.lng });
  const [resolved, setResolved]   = useState<ResolvedAddress | null>(null);
  const [resolving, setResolving] = useState(true);
  const [locating, setLocating]   = useState(false);
  const [userLoc, setUserLoc]     = useState<LatLng | null>(null);

  // Token so a slow geocode can't overwrite a newer pin's result.
  const reqSeq = useRef(0);
  // When the user taps "current location" we stash the exact GPS fix here, then
  // snap the pin to it once the map animation settles — so the confirmed lat/lng
  // is the device's exact position, not a map-centre approximation.
  const pendingGps = useRef<LatLng | null>(null);

  const outside    = !isInsideServiceArea(pin.lat, pin.lng);
  const canConfirm = !!resolved && !outside && !resolving;
  const kmAway     = userLoc ? distanceKm(pin.lat, pin.lng, userLoc.lat, userLoc.lng) : null;

  const resolvePin = useCallback(async (next: LatLng) => {
    const seq = ++reqSeq.current;
    setResolving(true);
    try {
      const r = await reverseGeocode(next.lat, next.lng);
      if (seq !== reqSeq.current) return;
      setResolved(r);
    } catch {
      if (seq !== reqSeq.current) return;
      setResolved(fallbackResolved(t('address.pickedLocation')));
    } finally {
      if (seq === reqSeq.current) setResolving(false);
    }
  }, [t]);

  // On mount: resolve the default centre so the card has content; if the sheet
  // asked, also home in on the device.
  useEffect(() => {
    void resolvePin(pin);
    if (autoLocate) void goToCurrent();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const onRegionChangeComplete = useCallback((r: Region) => {
    const center: LatLng = { lat: r.latitude, lng: r.longitude };
    const gps = pendingGps.current;
    if (gps && distanceKm(center.lat, center.lng, gps.lat, gps.lng) < SNAP_KM) {
      // Animation settled on the GPS fix — lock the pin to the exact coords.
      pendingGps.current = null;
      setPin(gps);
      void resolvePin(gps);
    } else {
      pendingGps.current = null;
      setPin(center);
      void resolvePin(center);
    }
  }, [resolvePin]);

  async function goToCurrent() {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Bringly', t('address.locationDenied')); return; }
      // Highest accuracy + a fresh fix (no cached last-known) so the pin lands on
      // the device's exact position.
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      const here: LatLng = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      setUserLoc(here);
      pendingGps.current = here;
      mapRef.current?.animateToRegion(
        { latitude: here.lat, longitude: here.lng, latitudeDelta: 0.004, longitudeDelta: 0.004 },
        600,
      );
    } catch {
      Alert.alert('Bringly', t('address.locationDenied'));
    } finally {
      setLocating(false);
    }
  }

  function handleConfirm() {
    if (!canConfirm || !resolved) return;
    navigation.navigate('AddressDetails', {
      lat: pin.lat,
      lng: pin.lng,
      title:    resolved.title,
      subtitle: resolved.subtitle,
      locality: resolved.locality,
      city:     resolved.city,
      pincode:  resolved.pincode,
    });
  }

  const initialRegion: Region = {
    latitude: CHIRAWA_CENTER.lat, longitude: CHIRAWA_CENTER.lng,
    latitudeDelta: 0.012, longitudeDelta: 0.012,
  };

  return (
    <View style={styles.flex}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        onRegionChangeComplete={onRegionChangeComplete}
        showsPointsOfInterest          // nearby shops / landmarks from Google
        showsUserLocation
        showsMyLocationButton={false}
      />

      {/* Fixed orange lollipop pin — the map slides underneath it. */}
      <View style={styles.pinOverlay} pointerEvents="none">
        <View style={styles.tooltip}>
          <Text style={styles.tooltipStrong}>{t('address.orderDeliverHere')}</Text>
          <Text style={styles.tooltipSub}>{t('address.placePinExact')}</Text>
        </View>
        <View style={styles.lollipop}>
          <View style={styles.lollipopHead}><View style={styles.lollipopDot} /></View>
          <View style={styles.lollipopStalk} />
        </View>
        <View style={styles.pinShadow} />
      </View>

      {/* Go to current location */}
      <TouchableOpacity
        style={[styles.currentBtn, { bottom: cardHeight(insets.bottom) + Spacing.md }]}
        onPress={() => void goToCurrent()}
        disabled={locating}
        activeOpacity={0.85}
      >
        {locating
          ? <ActivityIndicator size="small" color={Colors.primary} />
          : <Ionicons name="locate" size={18} color={Colors.primary} />}
        <Text style={styles.currentBtnText}>{t('address.goToCurrent')}</Text>
      </TouchableOpacity>

      {/* Bottom card */}
      <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
        {outside && (
          <View style={styles.warnRow}>
            <Ionicons name="rocket-outline" size={16} color={Colors.warning} />
            <Text style={styles.warnText}>{t('address.comingSoon')}</Text>
          </View>
        )}

        <Text style={styles.cardHeading}>{t('address.deliveringTo')}</Text>
        <View style={styles.addrRow}>
          <Ionicons name="location" size={20} color={Colors.primary} style={{ marginTop: 2 }} />
          <View style={styles.addrTextWrap}>
            {resolving ? (
              <Text style={styles.addrTitle}>{t('address.locatingAddress')}</Text>
            ) : (
              <>
                <Text style={styles.addrTitle} numberOfLines={1}>{resolved?.title}</Text>
                <Text style={styles.addrSub} numberOfLines={2}>{resolved?.subtitle}</Text>
              </>
            )}
          </View>
        </View>

        {kmAway != null && !resolving && (
          <Text style={styles.kmAway}>
            {t('address.pinKmPrefix')} {kmAway.toFixed(1)} {t('address.pinKmSuffix')}
          </Text>
        )}

        <TouchableOpacity
          style={[styles.confirmBtn, !canConfirm && styles.confirmBtnDisabled]}
          onPress={handleConfirm}
          disabled={!canConfirm}
          activeOpacity={0.9}
        >
          <Text style={styles.confirmBtnText}>{t('address.confirmLocation')}</Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.white} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Rough card height used only to float the "current location" button above it.
function cardHeight(bottomInset: number): number {
  return 188 + bottomInset;
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: Colors.background },

    // Centre pin overlay
    pinOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center', justifyContent: 'center',
      paddingBottom: 188, // lift the pin into the map area above the card
    },
    tooltip: {
      backgroundColor: 'rgba(20,20,20,0.88)',
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
      alignItems: 'center', marginBottom: 8, maxWidth: 250,
    },
    tooltipStrong: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
    tooltipSub:    { color: 'rgba(255,255,255,0.82)', fontSize: FontSize.xs, marginTop: 1 },

    // Orange lollipop: round head + thin stalk + ground shadow
    lollipop: { alignItems: 'center' },
    lollipopHead: {
      width: 28, height: 28, borderRadius: 14,
      backgroundColor: Colors.primary,
      borderWidth: 3, borderColor: '#fff',
      alignItems: 'center', justifyContent: 'center',
      ...Shadow.md,
    },
    lollipopDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
    lollipopStalk: {
      width: 3, height: 16, backgroundColor: Colors.primary, marginTop: -1,
    },
    pinShadow: {
      width: 18, height: 6, borderRadius: 9,
      backgroundColor: 'rgba(0,0,0,0.22)', marginTop: 1,
    },

    // Current-location pill
    currentBtn: {
      position: 'absolute', right: Spacing.lg,
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: Colors.surface,
      borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border,
      paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
      ...Shadow.sm,
    },
    currentBtnText: { color: Colors.primary, fontWeight: FontWeight.bold, fontSize: FontSize.sm },

    // Bottom card
    card: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      backgroundColor: Colors.surface,
      borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
      paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg,
      gap: Spacing.sm,
      ...Shadow.lg,
    },
    warnRow: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: Colors.warningLight, borderRadius: Radius.sm,
      paddingHorizontal: Spacing.sm, paddingVertical: 6,
    },
    warnText: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, flex: 1 },

    cardHeading: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
    addrRow:     { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
    addrTextWrap:{ flex: 1 },
    addrTitle:   { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
    addrSub:     { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2, lineHeight: 19 },
    kmAway:      { fontSize: FontSize.sm, color: Colors.error, fontWeight: FontWeight.medium },

    confirmBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
      backgroundColor: Colors.primary,
      borderRadius: Radius.lg, height: 54, marginTop: Spacing.xs,
      ...Shadow.primary,
    },
    confirmBtnDisabled: { backgroundColor: Colors.disabled, ...Shadow.none },
    confirmBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: FontWeight.heavy },
  });
