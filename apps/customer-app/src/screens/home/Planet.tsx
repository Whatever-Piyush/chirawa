import React from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';

// Decorative background planets drawn purely with Views (no images, to match the
// imageless app). Jupiter = banded gas giant + Great Red Spot; Saturn = pale
// sphere with a tilted ring. Always pointerEvents="none" so taps pass through.
type Kind = 'jupiter' | 'saturn' | 'neptune';

interface Band { t: number; h: number; c: string } // fractions of diameter

const JUPITER_BANDS: Band[] = [
  { t: 0.00, h: 0.20, c: '#A9743F' },
  { t: 0.20, h: 0.16, c: '#E0BE91' },
  { t: 0.36, h: 0.14, c: '#C49A63' },
  { t: 0.50, h: 0.16, c: '#9C6B43' },
  { t: 0.66, h: 0.14, c: '#E3C39A' },
  { t: 0.80, h: 0.20, c: '#B98B5A' },
];

const SATURN_BANDS: Band[] = [
  { t: 0.00, h: 0.24, c: '#D9C089' },
  { t: 0.24, h: 0.20, c: '#E9D6A6' },
  { t: 0.44, h: 0.18, c: '#CBA86A' },
  { t: 0.62, h: 0.20, c: '#E0C78F' },
  { t: 0.82, h: 0.18, c: '#C29A5E' },
];

const NEPTUNE_BANDS: Band[] = [
  { t: 0.00, h: 0.28, c: '#2E5BC0' },
  { t: 0.28, h: 0.18, c: '#3E74D6' },
  { t: 0.46, h: 0.18, c: '#2A53B0' },
  { t: 0.64, h: 0.18, c: '#4A82E0' },
  { t: 0.82, h: 0.18, c: '#244A9E' },
];

const BANDS: Record<Kind, Band[]> = {
  jupiter: JUPITER_BANDS,
  saturn:  SATURN_BANDS,
  neptune: NEPTUNE_BANDS,
};

export default function Planet({
  kind, size, style,
}: { kind: Kind; size: number; style?: ViewStyle }) {
  const bands = BANDS[kind];

  return (
    <View pointerEvents="none" style={[styles.wrap, { width: size, height: size }, style]}>
      {/* Saturn's ring — drawn first so the sphere sits on top (ring reads behind). */}
      {kind === 'saturn' && (
        <View
          style={[
            styles.ring,
            {
              width: size * 2.05,
              height: size * 2.05,
              borderRadius: size,
              borderWidth: Math.max(2, size * 0.06),
              top: -size * 0.525,
              left: -size * 0.525,
            },
          ]}
        />
      )}

      {/* Sphere with clipped horizontal bands */}
      <View style={[styles.sphere, { width: size, height: size, borderRadius: size / 2 }]}>
        {bands.map((b, i) => (
          <View
            key={i}
            style={{
              position: 'absolute', left: 0, right: 0,
              top: b.t * size, height: b.h * size + 0.5,
              backgroundColor: b.c,
            }}
          />
        ))}

        {/* Jupiter's Great Red Spot */}
        {kind === 'jupiter' && (
          <View
            style={{
              position: 'absolute',
              top: size * 0.52, left: size * 0.56,
              width: size * 0.24, height: size * 0.14,
              borderRadius: size * 0.12,
              backgroundColor: '#A8472A',
            }}
          />
        )}

        {/* Soft top-left highlight for a 3-D feel */}
        <View
          style={{
            position: 'absolute',
            top: size * 0.06, left: size * 0.12,
            width: size * 0.42, height: size * 0.3,
            borderRadius: size * 0.21,
            backgroundColor: 'rgba(255,255,255,0.18)',
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
  sphere: { overflow: 'hidden' },
  ring: {
    position: 'absolute',
    borderColor: 'rgba(230,207,154,0.7)',
    backgroundColor: 'transparent',
    transform: [{ rotate: '-20deg' }, { scaleY: 0.34 }],
  },
});
