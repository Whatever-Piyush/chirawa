import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Colors, Radius, Shadow } from '../../theme';

export type CardShadow = 'none' | 'xs' | 'sm' | 'md' | 'lg';

interface Props {
  children:  React.ReactNode;
  style?:    StyleProp<ViewStyle>;
  onPress?:  (e: GestureResponderEvent) => void;
  shadow?:   CardShadow;
  disabled?: boolean;
  testID?:   string;
}

const SHADOW_MAP: Record<CardShadow, object> = {
  none: Shadow.none,
  xs:   Shadow.xs,
  sm:   Shadow.sm,
  md:   Shadow.md,
  lg:   Shadow.lg,
};

export default function Card({
  children,
  style,
  onPress,
  shadow = 'sm',
  disabled,
  testID,
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  const base: ViewStyle = {
    backgroundColor: Colors.surface,
    borderRadius:    Radius.lg,
    ...(SHADOW_MAP[shadow] as ViewStyle),
  };

  if (!onPress) {
    return (
      <View style={[base, style]} testID={testID}>
        {children}
      </View>
    );
  }

  const pressIn = () => {
    Animated.spring(scale, {
      toValue:         0.97,
      friction:        8,
      tension:         300,
      useNativeDriver: true,
    }).start();
  };

  const pressOut = () => {
    Animated.spring(scale, {
      toValue:         1,
      friction:        8,
      tension:         300,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={disabled}
      testID={testID}
    >
      <Animated.View style={[base, { transform: [{ scale }] }, style]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _styles = StyleSheet.create({});
