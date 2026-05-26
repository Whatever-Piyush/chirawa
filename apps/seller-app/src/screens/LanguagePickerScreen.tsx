import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { useLanguage } from '@chirawa/i18n';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function LanguagePickerScreen() {
  const { setLanguage } = useLanguage();
  const [selected, setSelected] = useState<'hi' | 'en' | null>(null);

  function handleSelect(lang: 'hi' | 'en') {
    setSelected(lang);
    setTimeout(() => {
      setLanguage(lang);
    }, 300);
  }

  return (
    <View style={styles.container}>
      <View style={styles.topSection}>
        <Text style={styles.logoEmoji}>🛵</Text>
        <Text style={styles.brandName}>Bringly</Text>
        <Text style={styles.subtitle}>Choose your language</Text>
        <Text style={styles.subtitle}>अपनी भाषा चुनें</Text>
      </View>
      <View style={styles.bottomSection}>
        <TouchableOpacity
          style={styles.card}
          onPress={() => handleSelect('hi')}
          activeOpacity={0.8}
        >
          <Text style={styles.cardPrimary}>हिंदी</Text>
          <Text style={styles.cardSecondary}>Hindi</Text>
          <View style={[styles.radio, selected === 'hi' && styles.radioSelected]} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.card}
          onPress={() => handleSelect('en')}
          activeOpacity={0.8}
        >
          <Text style={styles.cardPrimary}>English</Text>
          <Text style={styles.cardSecondary}>अंग्रेज़ी</Text>
          <View style={[styles.radio, selected === 'en' && styles.radioSelected]} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FF3E6C',
  },
  topSection: {
    flex: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomSection: {
    flex: 6,
    alignItems: 'center',
    paddingTop: 8,
  },
  logoEmoji: {
    fontSize: 64,
    marginBottom: 8,
  },
  brandName: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  subtitle: {
    color: '#FFFFFF',
    fontSize: 16,
    opacity: 0.85,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    width: SCREEN_WIDTH * 0.85,
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  cardPrimary: {
    flex: 1,
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1A1A1A',
  },
  cardSecondary: {
    fontSize: 14,
    color: '#666666',
    marginRight: 12,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#FF3E6C',
  },
  radioSelected: {
    backgroundColor: '#FF3E6C',
  },
});
