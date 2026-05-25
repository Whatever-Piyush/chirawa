import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, FontSize } from '../../theme';

export default function ProfileScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>ProfileScreen — Coming Soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  text:      { fontSize: FontSize.lg, color: Colors.textLight },
});
