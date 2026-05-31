import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Image, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useT } from '@chirawa/i18n';
import { Text } from '../../components/ui';
import { Spacing, Radius } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { fetchCategories, type ApiCategory } from '../../services/catalog';
import type { RootStackParamList } from '../../navigation/AppNavigator';

// Categories tab — real categories from /catalog/categories. Each row opens the
// CategoryProducts grid for that category (across all shops).
export default function CategoriesScreen() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    let active = true;
    fetchCategories()
      .then((c) => { if (active) setCategories(c); })
      .catch(() => { /* tolerate */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Text weight="bold" color={Colors.white} style={styles.title}>
          {t('home.tabCategories')}
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={categories}
          keyExtractor={(item) => item.name}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('CategoryProducts', { category: item.name })}
            >
              <View style={styles.thumb}>
                {item.imageUrl
                  ? <Image source={{ uri: item.imageUrl }} style={styles.thumbImg} resizeMode="contain" />
                  : <View style={[styles.thumbImg, { backgroundColor: '#FFF0E9' }]} />}
              </View>
              <View style={styles.info}>
                <Text weight="semibold" color={Colors.textPrimary} numberOfLines={1} style={styles.name}>
                  {item.name}
                </Text>
                <Text weight="regular" color={Colors.textSecondary} style={styles.count}>
                  {item.productCount} item{item.productCount === 1 ? '' : 's'}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    backgroundColor:   Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingBottom:     Spacing.md,
  },
  title:  { fontSize: 22, lineHeight: 28 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list:   { padding: Spacing.lg, gap: 10, paddingBottom: Spacing.xxxl },
  row: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: Colors.surface,
    borderRadius:    Radius.md,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         10,
    gap:             12,
  },
  thumb: {
    width: 52, height: 52, borderRadius: 10,
    backgroundColor: '#FFFFFF', overflow: 'hidden',
    justifyContent: 'center', alignItems: 'center',
  },
  thumbImg: { width: '100%', height: '100%' },
  info:  { flex: 1 },
  name:  { fontSize: 15, lineHeight: 19 },
  count: { fontSize: 12, lineHeight: 16, marginTop: 2 },
});
