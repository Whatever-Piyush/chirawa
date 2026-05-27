import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

interface Props {
  children:    React.ReactNode;
  onPress?:    (e: GestureResponderEvent) => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  disabled?:   boolean;
  style?:      StyleProp<ViewStyle>;
  scaleTo?:    number;
  hitSlop?:    number | { top?: number; bottom?: number; left?: number; right?: number };
  testID?:     string;
  accessibilityLabel?: string;
  accessibilityRole?:  'button' | 'link' | 'none';
}

export default function PressableScale({
  children,
  onPress,
  onLongPress,
  disabled,
  style,
  scaleTo = 0.95,
  hitSlop,
  testID,
  accessibilityLabel,
  accessibilityRole = 'button',
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () => {
    Animated.spring(scale, {
      toValue:         scaleTo,
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
      onLongPress={onLongPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={disabled}
      hitSlop={hitSlop}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
    >
      <Animated.View style={[{ transform: [{ scale }] }, style]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
