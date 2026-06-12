import React from 'react';
import { View, type ViewStyle } from 'react-native';

// A custom-drawn moon (pure Views, no images): a pale glowing sphere with a soft
// halo, a few craters, a gentle terminator shade, and a highlight for depth.
export default function Moon({ size = 46, style }: { size?: number; style?: ViewStyle }) {
  const s = size;
  return (
    <View
      pointerEvents="none"
      style={[{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      {/* Soft glow halo (two layers) */}
      <View style={{ position: 'absolute', width: s * 1.55, height: s * 1.55, borderRadius: s * 0.78, backgroundColor: 'rgba(244,241,230,0.12)' }} />
      <View style={{ position: 'absolute', width: s * 1.22, height: s * 1.22, borderRadius: s * 0.61, backgroundColor: 'rgba(244,241,230,0.18)' }} />

      {/* Sphere */}
      <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: '#F4F1E6', overflow: 'hidden' }}>
        {/* Terminator — a faint cool shade along the right edge */}
        <View style={{ position: 'absolute', right: -s * 0.2, top: -s * 0.05, width: s, height: s * 1.1, borderRadius: s / 2, backgroundColor: 'rgba(60,50,90,0.10)' }} />

        {/* Craters */}
        <View style={{ position: 'absolute', top: s * 0.22, left: s * 0.26, width: s * 0.17, height: s * 0.17, borderRadius: s * 0.085, backgroundColor: 'rgba(120,110,140,0.20)' }} />
        <View style={{ position: 'absolute', top: s * 0.54, left: s * 0.50, width: s * 0.12, height: s * 0.12, borderRadius: s * 0.06, backgroundColor: 'rgba(120,110,140,0.17)' }} />
        <View style={{ position: 'absolute', top: s * 0.62, left: s * 0.24, width: s * 0.09, height: s * 0.09, borderRadius: s * 0.045, backgroundColor: 'rgba(120,110,140,0.15)' }} />

        {/* Top-left highlight */}
        <View style={{ position: 'absolute', top: s * 0.10, left: s * 0.14, width: s * 0.34, height: s * 0.26, borderRadius: s * 0.17, backgroundColor: 'rgba(255,255,255,0.40)' }} />
      </View>
    </View>
  );
}
