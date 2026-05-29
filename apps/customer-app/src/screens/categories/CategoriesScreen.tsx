import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@chirawa/i18n';
import { Text } from '../../components/ui';
import { Colors, Spacing } from '../../theme';
import CategoryGrid, { GROCERY_KITCHEN, SNACKS_DRINKS } from '../home/CategoryGrid';

// Categories tab. Reuses the CategoryGrid built in Chunk 6 — the same Grocery
// & Kitchen and Snacks & Drinks sections shown on Home, here as the dedicated
// browse surface. Tab screens render headerShown:false, so we own the top
// padding / title.
export default function CategoriesScreen() {
  const t = useT();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Text weight="bold" color={Colors.white} style={styles.title}>
          {t('home.tabCategories')}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <CategoryGrid title={t('home.groceryKitchen')} items={GROCERY_KITCHEN} />
        <CategoryGrid title={t('home.snacksDrinks')}   items={SNACKS_DRINKS} />
        <View style={{ height: Spacing.huge }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    backgroundColor:   Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingBottom:     Spacing.md,
  },
  title: { fontSize: 22, lineHeight: 28 },
  scroll: { paddingBottom: Spacing.xxxl },
});
