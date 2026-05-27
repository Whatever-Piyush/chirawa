import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
} from 'react-native';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { Spacing } from '../theme';

export default function AnimatedTabButton(props: BottomTabBarButtonProps) {
  const { onPress, children, accessibilityLabel, testID, accessibilityState } = props;
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () => {
    Animated.timing(scale, {
      toValue:         0.85,
      duration:        80,
      useNativeDriver: true,
    }).start();
  };

  const pressOut = () => {
    Animated.spring(scale, {
      toValue:         1,
      friction:        4,
      tension:         200,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress as (e: GestureResponderEvent) => void}
      onPressIn={pressIn}
      onPressOut={pressOut}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      testID={testID}
      style={styles.button}
    >
      <Animated.View style={[styles.inner, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
  },
  inner: {
    alignItems:     'center',
    justifyContent: 'center',
    paddingTop:     Spacing.xs,
  },
});
