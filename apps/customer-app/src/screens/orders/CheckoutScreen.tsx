import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, FontSize } from '../../theme';

export default function CheckoutScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>CheckoutScreen — Coming Soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  text:      { fontSize: FontSize.lg, color: Colors.textLight },
});
