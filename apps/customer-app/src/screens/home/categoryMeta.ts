// Presentation metadata for the home category surfaces. Category names come from
// the API; this file only adds a leading emoji and groups them into themed
// sections. Keep names in sync with the seed's category names.

export const CATEGORY_EMOJI: Record<string, string> = {
  'Grocery & Kitchen': '🛒',
  'Dairy & Bread':     '🥛',
  'Snacks & Drinks':   '🍟',
  'Vegetables':        '🥦',
  'Fruits':            '🍎',
  'Mangoes & Melons':  '🥭',
  'Dry Fruits & Nuts': '🥜',
  'Bakery':            '🥐',
  'Sauces & Spreads':  '🫙',
  'Sweets & Mithai':   '🍬',
  // Beauty & Personal Care sub-categories
  'Bath & Body':        '🧼',
  'Hair Care':          '💇',
  'Skin & Face':        '🧴',
  'Beauty & Cosmetics': '💄',
  'Feminine Hygiene':   '🌸',
  'Baby Care':          '🍼',
  'Health & Pharma':    '💊',
  'Sexual Wellness':    '❤️',
  // Household Essentials sub-categories
  'Home & Lifestyle':      '🏠',
  'Cleaners & Repellents': '🧹',
  'Electronics':           '🎧',
  'Stationery & Games':    '✏️',
  'Grocery':           '🛍️',
};

// Themed home sections — each renders as a title + a grid of 4 equal tiles.
// Each tile shows a copyright-safe emoji icon + label and maps to a real
// product category (`category`), so tapping always opens real products. A tile
// is only shown when its backing category exists in the live data.
export interface SectionTile {
  label:    string;   // display label (common grocery wording, 2 lines)
  emoji:    string;
  category: string;   // backing category name → CategoryProducts
}

export interface SectionGroup {
  title: string;
  tiles: SectionTile[];
}

// ─── Two-pane category view (left sub-rail + right grid) ───────────────────────
// Path A: the left rail's "sub-categories" are a SECTION_GROUP's tiles, deduped
// to their distinct backing categories (so two tiles pointing at the same real
// category don't render identical grids). Until the data is split into finer
// categories, this is the best taxonomy we have.

export interface SubCategory {
  label:    string;
  emoji:    string;
  category: string;   // backing live category → fetchProducts({ category })
}

export interface CategoryView {
  mainTitle: string;
  subs:      SubCategory[];
}

/**
 * Resolve an incoming category (either a SECTION_GROUP title or a leaf category
 * name) into the main title + its sub-category rail. Falls back to a single-item
 * rail when the category isn't part of any group.
 */
export function resolveCategoryView(category: string): CategoryView {
  const group =
    SECTION_GROUPS.find((g) => g.title === category) ??
    SECTION_GROUPS.find((g) => g.tiles.some((t) => t.category === category));

  if (group) {
    const seen = new Set<string>();
    const subs: SubCategory[] = [];
    for (const tile of group.tiles) {
      if (seen.has(tile.category)) continue;   // first label wins per backing category
      seen.add(tile.category);
      subs.push({ label: tile.label, emoji: tile.emoji, category: tile.category });
    }
    return { mainTitle: group.title, subs };
  }

  return {
    mainTitle: category,
    subs: [{ label: category, emoji: CATEGORY_EMOJI[category] ?? '🛍️', category }],
  };
}

export const SECTION_GROUPS: ReadonlyArray<SectionGroup> = [
  {
    title: 'Grocery & Kitchen',
    tiles: [
      { label: 'Vegetables & Fruits', emoji: '🥦', category: 'Vegetables' },
      { label: 'Atta, Rice & Dal',    emoji: '🌾', category: 'Grocery & Kitchen' },
      { label: 'Oil, Ghee & Masala',  emoji: '🧈', category: 'Grocery & Kitchen' },
      { label: 'Dairy, Bread & Eggs', emoji: '🥚', category: 'Dairy & Bread' },
      { label: 'Bakery & Biscuits',   emoji: '🥐', category: 'Bakery' },
      { label: 'Dry Fruits & Nuts',   emoji: '🥜', category: 'Dry Fruits & Nuts' },
      { label: 'Tea, Coffee & More',  emoji: '☕', category: 'Grocery & Kitchen' },
      { label: 'Sweets & Mithai',     emoji: '🍬', category: 'Sweets & Mithai' },
    ],
  },
  {
    title: 'Snacks & Drinks',
    tiles: [
      { label: 'Chips & Namkeen',       emoji: '🍟', category: 'Snacks & Drinks' },
      { label: 'Cold Drinks & Juices',  emoji: '🥤', category: 'Snacks & Drinks' },
      { label: 'Instant Food',          emoji: '🍜', category: 'Snacks & Drinks' },
      { label: 'Sauces & Spreads',      emoji: '🍯', category: 'Sauces & Spreads' },
      { label: 'Cookies & Biscuits',    emoji: '🍪', category: 'Bakery' },
      { label: 'Chocolates & Sweets',   emoji: '🍫', category: 'Sweets & Mithai' },
      { label: 'Cereals & More',        emoji: '🥣', category: 'Grocery & Kitchen' },
      { label: 'Dry Fruits',            emoji: '🌰', category: 'Dry Fruits & Nuts' },
    ],
  },
  {
    title: 'Fresh & Daily',
    tiles: [
      { label: 'Fresh Vegetables', emoji: '🥬', category: 'Vegetables' },
      { label: 'Fresh Fruits',     emoji: '🍎', category: 'Fruits' },
      { label: 'Mangoes & Melons', emoji: '🥭', category: 'Mangoes & Melons' },
      { label: 'Milk & Dairy',     emoji: '🥛', category: 'Dairy & Bread' },
    ],
  },
  {
    title: 'Beauty & Personal Care',
    tiles: [
      { label: 'Bath & Body',         emoji: '🧼', category: 'Bath & Body' },
      { label: 'Hair',                emoji: '💇', category: 'Hair Care' },
      { label: 'Skin & Face',         emoji: '🧴', category: 'Skin & Face' },
      { label: 'Beauty & Cosmetics',  emoji: '💄', category: 'Beauty & Cosmetics' },
      { label: 'Feminine Hygiene',    emoji: '🌸', category: 'Feminine Hygiene' },
      { label: 'Baby Care',           emoji: '🍼', category: 'Baby Care' },
      { label: 'Health & Pharma',     emoji: '💊', category: 'Health & Pharma' },
      { label: 'Sexual Wellness',     emoji: '❤️', category: 'Sexual Wellness' },
    ],
  },
  {
    title: 'Household Essentials',
    tiles: [
      { label: 'Home & Lifestyle',      emoji: '🏠', category: 'Home & Lifestyle' },
      { label: 'Cleaners & Repellents', emoji: '🧹', category: 'Cleaners & Repellents' },
      { label: 'Electronics',           emoji: '🎧', category: 'Electronics' },
      { label: 'Stationery & Games',    emoji: '✏️', category: 'Stationery & Games' },
    ],
  },
];

// The top product carousels — each has a title, optional subtitle, and a tab bar.
// A tab shows `label` but filters by `category`; category 'All' is a no-filter
// tab (mixed products). Decoupling label/category lets us show short labels
// (e.g. "Veggies") while filtering a real category ("Vegetables").
export interface CarouselTab {
  label:    string;
  category: string;   // 'All' = no filter
}

export interface CarouselSection {
  title:     string;
  subtitle?: string;
  tabs:      CarouselTab[];
}

export const CAROUSEL_SECTIONS: ReadonlyArray<CarouselSection> = [
  {
    title: 'For You',
    tabs: [
      { label: 'All',               category: 'All' },
      { label: 'Grocery & Kitchen', category: 'Grocery & Kitchen' },
      { label: 'Dairy & Bread',     category: 'Dairy & Bread' },
      { label: 'Snacks & Drinks',   category: 'Snacks & Drinks' },
      { label: 'Skin & Face',       category: 'Skin & Face' },
      { label: 'Bakery',            category: 'Bakery' },
    ],
  },
  {
    title: 'Fresh',
    subtitle: 'Handpicked daily essentials',
    tabs: [
      { label: 'Veggies',          category: 'Vegetables' },
      { label: 'Fruits',           category: 'Fruits' },
      { label: 'Mangoes & Melons', category: 'Mangoes & Melons' },
    ],
  },
];
