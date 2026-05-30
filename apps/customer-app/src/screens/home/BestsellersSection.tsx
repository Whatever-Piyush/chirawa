import React, { useEffect, useState } from 'react';
import {
  View, Image, FlatList, TouchableOpacity, StyleSheet, Dimensions, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Text, SectionContainer } from '../../components/ui';
import { Colors } from '../../theme';
import { fetchCategories, type ApiCategory } from '../../services/catalog';
import type { RootStackParamList } from '../../navigation/AppNavigator';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Real category cards backed by /catalog/categories. Each shows a sample
// image + live product count and opens that category's product grid.
const PALETTE = ['#FFF8E1', '#FFF0F5', '#E8F5E9', '#FFF5EE', '#F3F0FF', '#E6F7F4'];

const SECTION_HPAD = 16;
const CARD_GAP     = 8;
const CARD_WIDTH   = Math.floor((SCREEN_WIDTH - SECTION_HPAD * 2 - CARD_GAP * 2) / 3);
const IMG_SIZE     = CARD_WIDTH - 20;
const LABEL_LINE   = 16;
const LABEL_HEIGHT = LABEL_LINE * 2;

interface CardProps {
  category: ApiCategory;
  bg:       string;
  onPress:  () => void;
}

function BestsellerCard({ category, bg, onPress }: CardProps) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[styles.card, { backgroundColor: bg }]}>
      <View style={styles.imageBox}>
        {category.imageUrl ? (
          <Image source={{ uri: category.imageUrl }} style={styles.image} resizeMode="contain" />
        ) : (
          <View style={[styles.image, { backgroundColor: bg }]} />
        )}
      </View>

      <Text color={Colors.textSecondary} style={styles.countText}>
        {category.productCount} item{category.productCount === 1 ? '' : 's'}
      </Text>

      <Text weight="semibold" color={Colors.textPrimary} numberOfLines={2} style={styles.label}>
        {category.name}
      </Text>
    </TouchableOpacity>
  );
}

export default function BestsellersSection() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
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

  if (!loading && categories.length === 0) return null;

  return (
    <SectionContainer title="Shop by category">
      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={categories}
          keyExtractor={(item) => item.name}
          numColumns={3}
          scrollEnabled={false}                /* lives inside HomeScreen's ScrollView */
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          renderItem={({ item, index }) => (
            <BestsellerCard
              category={item}
              bg={PALETTE[index % PALETTE.length]}
              onPress={() => navigation.navigate('CategoryProducts', { category: item.name })}
            />
          )}
        />
      )}
    </SectionContainer>
  );
}

const styles = StyleSheet.create({
  loading: { height: 120, justifyContent: 'center', alignItems: 'center' },
  grid: { paddingHorizontal: SECTION_HPAD, rowGap: CARD_GAP },
  row:  { gap: CARD_GAP, justifyContent: 'flex-start' },
  card: {
    width:        CARD_WIDTH,
    borderRadius: 14,
    borderWidth:  1,
    borderColor:  'rgba(0,0,0,0.05)',
    paddingHorizontal: 10,
    paddingVertical:   12,
    overflow:     'hidden',
  },
  imageBox: {
    width:          IMG_SIZE,
    height:         IMG_SIZE,
    borderRadius:   10,
    overflow:       'hidden',
    backgroundColor:'#FFFFFF',
    justifyContent: 'center',
    alignItems:     'center',
    marginBottom:   8,
  },
  image:     { width: '100%', height: '100%' },
  countText: { fontSize: 10, lineHeight: 13, marginBottom: 6 },
  label:     { fontSize: 12, lineHeight: LABEL_LINE, height: LABEL_HEIGHT },
});
