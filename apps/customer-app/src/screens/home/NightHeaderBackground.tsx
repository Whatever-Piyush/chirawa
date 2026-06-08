import React from 'react';
import { StyleSheet, type TextStyle } from 'react-native';
import { FauxGradient } from '../../components/ui';
import { NIGHT_FROM, NIGHT_TO } from './nightTheme';
import Starfield from './Starfield';
import Planet from './Planet';

// The shared night-header backdrop — gradient + stars + planets — so every
// screen's header looks like Home's when the store is closed. Absolute-fill,
// pointerEvents none (Starfield/Planet handle that), so taps pass through.
// `topInset` lets each header place the planets under the status bar correctly.
const HEADER_STARS: TextStyle[] = [
  { top: 8,  left: 30,   fontSize: 9,  opacity: 0.55 },
  { top: 20, left: 92,   fontSize: 5,  opacity: 0.32 },
  { top: 6,  left: 150,  fontSize: 7,  opacity: 0.42, color: '#BFD0FF' },
  { top: 26, left: 210,  fontSize: 4,  opacity: 0.28 },
  { top: 12, left: 255,  fontSize: 11, opacity: 0.65 },
  { top: 38, left: 130,  fontSize: 5,  opacity: 0.30 },
  { top: 50, left: 60,   fontSize: 6,  opacity: 0.34 },
  { top: 66, left: 140,  fontSize: 7,  opacity: 0.40, color: '#E2D2FF' },
  { top: 58, left: 230,  fontSize: 5,  opacity: 0.30 },
  { top: 84, left: 100,  fontSize: 4,  opacity: 0.26 },
  { top: 14, right: 80,  fontSize: 6,  opacity: 0.36 },
  { top: 34, right: 120, fontSize: 8,  opacity: 0.46 },
  { top: 22, right: 200, fontSize: 5,  opacity: 0.30, color: '#FFF1C9' },
  { top: 80, right: 30,  fontSize: 6,  opacity: 0.32 },
  { top: 70, right: 150, fontSize: 5,  opacity: 0.30 },
  { top: 96, right: 90,  fontSize: 4,  opacity: 0.24 },
  { bottom: 44, left: 40,  fontSize: 7, opacity: 0.42 },
  { bottom: 30, left: 180, fontSize: 5, opacity: 0.30, color: '#BFD0FF' },
  { bottom: 16, left: 100, fontSize: 6, opacity: 0.36 },
  { bottom: 50, left: 250, fontSize: 4, opacity: 0.26 },
  { bottom: 48, right: 70, fontSize: 9, opacity: 0.50 },
  { bottom: 26, right: 150,fontSize: 5, opacity: 0.30 },
  { bottom: 34, right: 30, fontSize: 7, opacity: 0.42 },
  { bottom: 18, right: 210,fontSize: 4, opacity: 0.26 },
];

export default function NightHeaderBackground({ topInset = 0 }: { topInset?: number }) {
  return (
    <>
      <FauxGradient from={NIGHT_FROM} to={NIGHT_TO} steps={18} style={StyleSheet.absoluteFill} />
      <Starfield stars={HEADER_STARS} />
      <Planet kind="saturn"  size={50} style={{ top: topInset + 2,  right: 112, opacity: 0.82 }} />
      <Planet kind="jupiter" size={22} style={{ top: topInset + 58, right: 40,  opacity: 0.66 }} />
    </>
  );
}
