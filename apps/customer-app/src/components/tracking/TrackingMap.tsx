import React, { useMemo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { FontSize, Radius, Spacing } from '../../theme';

export interface LatLng { lat: number; lng: number }

interface Props {
  customer: LatLng;            // delivery pin (static)
  rider: LatLng | null;        // live rider position (moving), null if unknown
  stale: boolean;              // true when the rider location is older than the freshness window
  t: (k: string) => string;
}

// Flat-earth distance is fine for a 3 km town.
function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Region tight enough to show both pins with a little padding.
function regionFor(a: LatLng, b: LatLng | null): Region {
  const pts = b ? [a, b] : [a];
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  return {
    latitude:  (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta:  Math.max(0.008, (maxLat - minLat) * 1.8),
    longitudeDelta: Math.max(0.008, (maxLng - minLng) * 1.8),
  };
}

export default function TrackingMap({ customer, rider, stale, t }: Props) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);
  const mapRef = useRef<MapView | null>(null);

  // Keep both pins in view as the rider moves.
  useEffect(() => {
    if (rider && mapRef.current) {
      mapRef.current.animateToRegion(regionFor(customer, rider), 600);
    }
  }, [rider?.lat, rider?.lng, customer.lat, customer.lng]);

  const showRider = rider !== null && !stale;
  const etaMin = showRider && rider ? Math.max(1, Math.ceil((distanceKm(rider, customer) / 20) * 60)) : null;

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={regionFor(customer, rider)}
        pointerEvents="none"
      >
        <Marker coordinate={{ latitude: customer.lat, longitude: customer.lng }} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.homePin}><Text style={styles.pinEmoji}>🏠</Text></View>
        </Marker>
        {showRider && rider && (
          <Marker coordinate={{ latitude: rider.lat, longitude: rider.lng }} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.riderPin}><Text style={styles.pinEmoji}>🛵</Text></View>
          </Marker>
        )}
      </MapView>

      {showRider && etaMin !== null ? (
        <View style={styles.etaBadge}>
          <Text style={styles.etaText}>🛵  {t('tracking.arrivingIn')} ~{etaMin} {t('tracking.minutes')}</Text>
        </View>
      ) : (
        <View style={[styles.etaBadge, styles.etaBadgeMuted]}>
          <Text style={styles.etaTextMuted}>{t('tracking.locationUnavailable')}</Text>
        </View>
      )}
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    wrap: { height: 260, borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: Colors.surface },
    map:  { ...StyleSheet.absoluteFillObject },
    homePin:  { backgroundColor: Colors.card, borderRadius: Radius.full, padding: 6, borderWidth: 2, borderColor: Colors.success },
    riderPin: { backgroundColor: Colors.card, borderRadius: Radius.full, padding: 6, borderWidth: 2, borderColor: Colors.primary },
    pinEmoji: { fontSize: 20, lineHeight: 24 },
    etaBadge: {
      position: 'absolute', bottom: Spacing.md, alignSelf: 'center',
      backgroundColor: Colors.primary, borderRadius: Radius.full,
      paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    },
    etaBadgeMuted: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
    etaText:      { color: Colors.white, fontWeight: '800', fontSize: FontSize.sm },
    etaTextMuted: { color: Colors.textSecondary, fontWeight: '700', fontSize: FontSize.sm },
  });
