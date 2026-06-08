// Presentation metadata for the home category surfaces. Category names come from
// the API; this file only adds a leading emoji and groups them into themed
// sections. Keep names in sync with the seed's category names.

export const CATEGORY_EMOJI: Record<string, string> = {
  'Grocery & Kitchen': '🛒',
  'Dairy & Bread':     '🥛',
  'Snacks & Drinks':   '🍟',
  'Veggies & Fruits':  '🥦',
  'Dry Fruits & Nuts': '🥜',
  'Bakery':            '🥐',
  'Sauces & Spreads':  '🫙',
  'Sweets & Mithai':   '🍬',
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

export const SECTION_GROUPS: ReadonlyArray<SectionGroup> = [
  {
    title: 'Grocery & Kitchen',
    tiles: [
      { label: 'Vegetables & Fruits', emoji: '🥦', category: 'Veggies & Fruits' },
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
      { label: 'Fresh Vegetables', emoji: '🥬', category: 'Veggies & Fruits' },
      { label: 'Fresh Fruits',     emoji: '🍎', category: 'Veggies & Fruits' },
      { label: 'Milk & Dairy',     emoji: '🥛', category: 'Dairy & Bread' },
      { label: 'Bread & Eggs',     emoji: '🍞', category: 'Dairy & Bread' },
    ],
  },
];

// The two top product carousels — each has a title and a category tab bar.
// 'All' is a no-filter tab (mixed products).
export interface CarouselSection {
  title: string;
  tabs:  string[];
}

export const CAROUSEL_SECTIONS: ReadonlyArray<CarouselSection> = [
  { title: 'For You',       tabs: ['All', 'Grocery & Kitchen', 'Dairy & Bread', 'Snacks & Drinks', 'Bakery'] },
  { title: 'Fresh & Daily', tabs: ['Veggies & Fruits', 'Dry Fruits & Nuts', 'Sweets & Mithai', 'Sauces & Spreads'] },
];
