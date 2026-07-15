import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { TOTAL_TICKS } from '../utils/liveOrder';

// ── Segmented progress dial (Track_Order.md · Progress Indicator) ─────────────
// A ring of 5 ticks around the bubble's core, filling clockwise from 12 o'clock
// — one tick per order phase. Dependency-free (pure Views + rotation), mirroring
// the 5-segment progress bar language already used on the Home order cards.

const TICK_W = 3.5;
const TICK_H = 7;
const TICK_TOP = 2; // inset from the disc edge so the ring sits just outside the core

interface Props {
  filled:      number; // how many ticks are lit (1..TOTAL_TICKS)
  diameter:    number; // disc diameter the ring is laid out within
  filledColor: string;
  trackColor:  string;
}

function LiveOrderDial({ filled, diameter, filledColor, trackColor }: Props) {
  return (
    <View pointerEvents="none" style={[styles.container, { width: diameter, height: diameter }]}>
      {Array.from({ length: TOTAL_TICKS }, (_, i) => (
        <View
          key={i}
          style={[styles.spoke, { width: diameter, height: diameter, transform: [{ rotate: `${(i * 360) / TOTAL_TICKS}deg` }] }]}
        >
          <View
            style={{
              width:           TICK_W,
              height:          TICK_H,
              marginTop:       TICK_TOP,
              borderRadius:    TICK_W / 2,
              backgroundColor: i < filled ? filledColor : trackColor,
            }}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  spoke:     { position: 'absolute', alignItems: 'center' },
});

export default memo(LiveOrderDial);
