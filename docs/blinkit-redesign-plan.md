# Claude Code Task: Redesign Home Screen to Blinkit-Level UI/UX

## Context
you already have the access to the code file and you know what we have built till now 

i am giving you the instruction don't follow blindly just take this as a reference but if you know better that these instruction do that also if you found the instruction is not that much good for a particular thing you can use you higher intleligence to tackel that but the overall thing i want from you is this 
the file name and other thing this prompt include don't means anything you have to find the relevant file to make the changes and impelement things beacuse this prompt don't include the context of our project but the idea that we want to make is there 

---

## 🎨 Color System (define these as constants in a `theme.ts` or `colors.ts` file)

```ts
export const COLORS = {
  primary: '#FF6B35',           // Chirawa Orange — main brand color
  primaryDark: '#E85520',       // Darker orange for pressed states
  primaryLight: '#FFF0E9',      // Very light orange for chip backgrounds
  accent: '#C4383A',            // Deep red — used ONLY for "Chirawa's Special" footer button and section header
  background: '#FFF5EE',        // Warm cream — page background
  surface: '#FFFFFF',           // Card and component background
  textPrimary: '#1A1A2E',       // Deep navy for headings
  textSecondary: '#6B7280',     // Muted gray for subtitles and labels
  border: '#F0E0D6',            // Subtle warm border
  chipGrocery: '#FFF0E9',       // Category chip bg — Grocery
  chipSnacks: '#FFF8E1',        // Category chip bg — Snacks
  chipDairy: '#E8F5E9',         // Category chip bg — Dairy
  chipBeauty: '#FDF2F8',        // Category chip bg — Beauty
  chipActive: '#FF6B35',        // Active category chip fill
  special: '#FFF3E0',           // Chirawa's Special section background tint
  specialBorder: '#FFCC80',     // Chirawa's Special card border
  footerBg: '#FFFFFF',
  footerBorder: '#F0E0D6',
};
```

**Font family:** Use `Poppins` throughout (install via expo-font or react-native-google-fonts). Weights: 400 (Regular), 500 (Medium), 600 (SemiBold), 700 (Bold). Fall back to `System` if Poppins isn't loaded yet.

---

## 📁 File Structure

Create or modify these files:
- `src/screens/HomeScreen.tsx` — main home screen (or your existing equivalent)
- `src/components/home/SearchBar.tsx`
- `src/components/home/CategoryTabs.tsx`
- `src/components/home/BestsellersSection.tsx`
- `src/components/home/GroceryKitchenSection.tsx`
- `src/components/home/SnacksDrinksSection.tsx`
- `src/components/home/ChirawaSpecialSection.tsx`
- `src/components/home/FeaturedBanner.tsx`
- `src/components/layout/BottomNav.tsx`
- `src/constants/colors.ts` (or `theme.ts`)

---

## 🏠 HomeScreen.tsx — Overall Layout

The HomeScreen should be a `ScrollView` with a `stickyHeaderIndices` approach OR a `FlatList` with a `ListHeaderComponent` for the scrollable content. The bottom nav is fixed outside the scroll.

Structure:
```
<SafeAreaView bg={COLORS.background}>
  <Header />                    ← fixed at top, does NOT scroll
  <ScrollView>
    <SearchBar />
    <CategoryTabs />
    <FeaturedBanner />
    <BestsellersSection />
    <GroceryKitchenSection />
    <SnacksDrinksSection />
    <ChirawaSpecialSection />
    <View height={80} />        ← spacer so last item clears the bottom nav
  </ScrollView>
  <BottomNav />                 ← fixed at bottom
</SafeAreaView>
```

---

## 1️⃣ HEADER COMPONENT

**File:** Inline in `HomeScreen.tsx` or extract to `src/components/home/Header.tsx`

Layout: horizontal row with three zones — left (app name + tagline), center (empty), right (profile icon).

```
[APP NAME + tagline]            [👤 profile]
```

Specs:
- Background: `COLORS.primary` (`#FF6B35`)
- Height: ~80px (including safe area top padding)
- **Left zone:**
  - App name: `[YOUR_APP_NAME]` — font Poppins Bold, 22px, color `#FFFFFF`
  - Below it: A short animated tagline that cycles every 3 seconds between these strings (use a simple `setInterval` + state):
    - `"Chirawa ka apna bazar 🛺"`
    - `"Taza, seedha, jaldi 🌿"`
    - `"Ghar tak pahuncha do ✨"`
  - Tagline font: Poppins Regular, 12px, color `rgba(255,255,255,0.85)`
  - The tagline switch should use a fade animation (`Animated.timing` with opacity 0→1, 150ms)
- **Right zone:** A circular icon button (38px diameter, background `rgba(255,255,255,0.2)`, border-radius 19)
  - Use a user/profile icon (e.g., from `@expo/vector-icons` Ionicons: `person-circle-outline` at 26px, color white)
  - On press: navigate to Profile screen
- **No wallet icon, no delivery time, no location arrow** in the header — clean and minimal.

---

## 2️⃣ SEARCH BAR COMPONENT

**File:** `src/components/home/SearchBar.tsx`

Full-width bar below the header (outside the ScrollView header, can be sticky if desired).

Layout:
```
[🔍]  [animated placeholder text]              [🎙️]
```

Specs:
- Outer container: horizontal padding 16px, vertical padding 10px, background `COLORS.background`
- Bar: `backgroundColor: COLORS.surface`, `borderRadius: 14`, `borderWidth: 1`, `borderColor: COLORS.border`
- Height: 48px
- Slight shadow: `elevation: 2` (Android), `shadowColor: '#FF6B35', shadowOpacity: 0.08, shadowRadius: 4` (iOS)
- **Left icon:** Search/magnifying glass icon, 20px, color `COLORS.textSecondary`, left padding 14px
- **Placeholder animation:** The placeholder text should cycle every 1.5 seconds through these strings with a smooth slide-up + fade-in transition (`Animated.parallel` of `translateY` 8→0 and `opacity` 0→1, 200ms ease-out):
  - `"Search for atta, dal, ghee..."`
  - `"Search for biscuits, chips..."`
  - `"Search for soaps, shampoo..."`
  - `"Search for sweets, peda..."`
  - `"Search for masala, spices..."`
- When the user taps the bar, navigate to a search/results screen (or focus an actual TextInput)
- **Right icon:** Mic icon (`mic-outline` from Ionicons), 22px, color `COLORS.primary`, right padding 14px. On press: trigger voice search / show a toast "Voice search coming soon"

---

## 3️⃣ CATEGORY TABS COMPONENT

**File:** `src/components/home/CategoryTabs.tsx`

A horizontally scrollable row of pill-shaped chips. `ScrollView` with `horizontal` and `showsHorizontalScrollIndicator={false}`.

Padding: 14px left, 8px top/bottom. Gap between chips: 10px.

Categories (in order):
```
All | Beauty | Grocery | Snacks | Dairy
```

Each chip:
- Inactive: `backgroundColor: COLORS.surface`, `borderWidth: 1`, `borderColor: COLORS.border`, text color `COLORS.textSecondary`
- Active: `backgroundColor: COLORS.primary`, `borderColor: COLORS.primary`, text color `#FFFFFF`
- Border radius: 20 (pill)
- Padding: horizontal 16px, vertical 7px
- Font: Poppins Medium, 13px
- Include a small icon before the text (use Ionicons or MaterialIcons):
  - All → `grid-outline`
  - Beauty → `sparkles-outline`
  - Grocery → `leaf-outline`
  - Snacks → `fast-food-outline`
  - Dairy → `water-outline` or a custom milk icon
- On press: update `activeCategory` state and filter the sections accordingly (or scroll to the section)

---

## 4️⃣ FEATURED BANNER

**File:** `src/components/home/FeaturedBanner.tsx`

A single full-width card (margin: 0 16px) showing a promotional message.

Specs:
- Background: gradient from `#FF6B35` to `#FF9A5C` using `expo-linear-gradient` (or a flat `#FF6B35` if gradient isn't installed)
- Border radius: 14
- Height: ~80px
- Layout: text on left, decorative icon/illustration placeholder on right
- Text: `"🎉 Shop ₹499+ and get ₹50 off!"` — white, Poppins SemiBold, 14px
- Sub-text: `"Use code CHIRAWA50"` — white at 80% opacity, 12px
- Right side: a small shopping bag illustration (use a large icon `bag-outline` at 48px, white, 25% opacity as decoration)

---

## 5️⃣ BESTSELLERS SECTION

**File:** `src/components/home/BestsellersSection.tsx`

Section header row: "Bestsellers" (Poppins Bold 18px, `COLORS.textPrimary`) + "See all →" link on the right (Poppins Medium 13px, `COLORS.primary`).

Below: a 3-column grid (each column ~(screenWidth - 32 - 16) / 3 wide). Use `FlatList` with `numColumns={3}`.

**Categories to include (5 total — DO NOT include Electronics):**

| Category | Background Color | Sample products to show |
|---|---|---|
| Munchies & Drinks | `#FFF8E1` | Lays, KurKure, chips, cola |
| Ice Creams & Chocolates | `#FFF0F5` | KitKat, Dairy Milk, Kinder Joy |
| Dairy & Breakfast | `#E8F5E9` | Milk, paneer, butter, curd |
| Grocery Staples | `#FFF5EE` | Tata Salt, atta, dal, rice |
| Instant Foods & Sauces | `#F3F0FF` | Maggi, Knorr, Kissan ketchup |

Each card:
- Rounded card, `borderRadius: 14`, `borderWidth: 1`, `borderColor` using a tinted version of the card's bg color
- Background: the color from the table above
- Inside: a 2×2 grid of 4 small product image placeholders (colored rounded squares, 36×36px, each a slightly darker shade of the card bg)
- "+X more" text in small gray below the 2×2 grid
- Category name at bottom: Poppins SemiBold, 12px, `COLORS.textPrimary`
- Aspect ratio: ~1:1.1 (slightly taller than wide)
- Margin: 4px between cards

---

## 6️⃣ GROCERY & KITCHEN SECTION

**File:** `src/components/home/GroceryKitchenSection.tsx`

Section header: "Grocery & Kitchen" (same style as above).

4-column grid of category icon tiles. Use a `FlatList` with `numColumns={4}`.

**Categories (DO NOT include Chicken/Meat/Fish or Kitchenware/Appliances):**
1. Vegetables & Fruits — icon: leaf/apple
2. Atta, Rice & Dal — icon: grain/bowl
3. Oil, Ghee & Masala — icon: droplet/fire
4. Dairy, Bread & Eggs — icon: egg/milk
5. Bakery & Biscuits — icon: bread
6. Dry Fruits & Cereals — icon: nutrition

Each tile:
- Square card, `borderRadius: 12`, background `COLORS.surface`, `borderWidth: 1, borderColor: COLORS.border`
- Top: a colored rounded image placeholder (56×56px, `borderRadius: 10`)
- Bottom: category name, Poppins Medium, 11px, `COLORS.textPrimary`, `textAlign: center`
- Padding: 10px
- Width: (screenWidth - 32 - 24) / 4

---

## 7️⃣ SNACKS & DRINKS SECTION

**File:** `src/components/home/SnacksDrinksSection.tsx`

Same pattern as Grocery & Kitchen section (4-column icon grid).

**Categories (DO NOT include Paan Corner):**
1. Chips & Namkeen
2. Sweets & Chocolates
3. Drinks & Juices
4. Tea, Coffee & Milk Drinks
5. Instant Food
6. Sauces & Spreads
7. Ice Creams & More

Same tile spec as Grocery & Kitchen.

---

## 8️⃣ CHIRAWA'S SPECIAL SECTION ⭐ (NEW — UNIQUE FEATURE)

**File:** `src/components/home/ChirawaSpecialSection.tsx`

This is the most distinctive section of the app. It showcases famous local shops and vendors in Chirawa that have a loyal following.

**Section Header:**
- Left: `"Chirawa's Special ✨"` — Poppins Bold, 18px, `COLORS.accent` (`#C4383A`) — use the red accent color here, not the standard orange, to make it feel premium and special
- Left below header: `"The legendary tastes of our town"` — Poppins Regular, 12px, `COLORS.textSecondary`
- Right: `"See all →"` in `COLORS.accent`
- The entire header row sits on a subtle `#FFF3E0` background strip (full width, padding 14px 16px)

**Shop Cards — horizontal `ScrollView`:**
`showsHorizontalScrollIndicator={false}`, `paddingHorizontal: 16`, gap between cards: 12px

Each card width: ~170px, height: ~210px

Card spec:
```
┌──────────────────────────┐
│   [Shop Image / Color    │  ← 100px tall colored header area
│    Placeholder 🏪]       │     backgroundColor: warm gradient tint
│                          │     borderRadius top: 14
├──────────────────────────┤
│  Lalchand Mithai Wale    │  ← Poppins SemiBold, 13px, textPrimary
│  Famous for: Peda 🍬     │  ← Poppins Regular, 11px, textSecondary
│  ★ Local Legend          │  ← Small badge: bg #FFF3E0, text #C4383A, 10px
│  [Order Now →]           │  ← Small text button in COLORS.accent
└──────────────────────────┘
```

Card styling:
- `backgroundColor: COLORS.surface`
- `borderRadius: 14`
- `borderWidth: 1.5`
- `borderColor: COLORS.specialBorder` (`#FFCC80`)
- `elevation: 3` (Android shadow)
- iOS shadow: `shadowColor: '#FF6B35', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: {width: 0, height: 2}`

**Seed the section with these example shops (hardcode for now, connect to API later):**
```ts
const localShops = [
  {
    id: '1',
    name: 'Lalchand Mithai Wale',
    famousFor: 'Peda & Sweets',
    emoji: '🍬',
    badge: 'Local Legend',
    colorBg: '#FFE4B5',
  },
  {
    id: '2',
    name: 'Add your local shop',
    famousFor: 'Your specialty here',
    emoji: '🏪',
    badge: 'Coming Soon',
    colorBg: '#E8F5E9',
  },
  // Add more as the client provides shop names
];
```

Make the section easy to extend — the data should come from a prop or a local constant array so real shop data can be plugged in later.

---

## 9️⃣ BOTTOM NAVIGATION BAR

**File:** `src/components/layout/BottomNav.tsx`

Fixed to the bottom of the screen. Uses `position: absolute` or wraps screen in a `View` with `flex: 1`.

Height: 60px + safe area bottom inset (`useSafeAreaInsets().bottom`).
Background: `COLORS.footerBg` (`#FFFFFF`).
Top border: `0.5px solid COLORS.footerBorder`.
Shadow: `elevation: 8` (Android), `shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8` (iOS).

**4 tabs in order:**

| Tab | Icon | Label |
|---|---|---|
| Home | `home-outline` | Home |
| Order Again | `refresh-outline` | Order Again |
| Categories | `grid-outline` | Categories |
| Chirawa's Special | custom | *(see below)* |

First 3 tabs (Home, Order Again, Categories):
- Each tab: `flex: 1`, vertically centered icon + label
- Inactive: icon + text in `COLORS.textSecondary`, icon size 24px
- Active: icon + text in `COLORS.primary` (`#FF6B35`), icon slightly larger (26px)
- Label: Poppins Medium, 10px, below icon, 2px gap

**4th tab — Chirawa's Special (styled like Zomato's red button):**
This tab should NOT look like a normal tab. It should be a prominent raised button:
- `backgroundColor: COLORS.accent` (`#C4383A`)
- `borderRadius: 14`
- Width: ~90px, height: ~44px
- Sits slightly elevated (use `marginTop: -8px` to lift it above the tab bar baseline)
- `elevation: 6` on Android
- iOS shadow: `shadowColor: '#C4383A', shadowOpacity: 0.35, shadowRadius: 6`
- Inside: small star emoji + text `"Special"` OR an icon (`star-outline`) + "Special", white, Poppins Bold, 11px
- On press: navigate to the Chirawa's Special full screen

---

## ⚙️ GENERAL IMPLEMENTATION NOTES

1. **Typography wrapper:** Create a `<Text>` wrapper component (`AppText.tsx`) that applies Poppins font family by default so you don't repeat it everywhere.

2. **Section wrapper:** Create a `<SectionContainer>` component:
   ```tsx
   // Props: title, onSeeAll, children
   // Renders: header row (title + "See all") + children
   // Padding: horizontal 16px, marginTop 24px
   ```

3. **Image placeholders:** Use colored `View` components as image placeholders for all product/shop images now. Leave a comment: `{/* TODO: replace with <Image source={{uri: item.imageUrl}} /> */}`. The placeholder colors should be derived from the category's theme color.

4. **Section spacing:** 24px margin between sections.

5. **Scroll performance:** Use `FlatList` (not `ScrollView`) for all grid sections. For the main page scroll, use a `FlatList` with `ListHeaderComponent` containing all sections, or use a `ScrollView` with `removeClippedSubviews`.

6. **Status bar:** Set `StatusBar` to `barStyle="light-content"` and `backgroundColor={COLORS.primary}` so the orange header matches the status bar on Android.

7. **Safe area:** Wrap the root in `<SafeAreaProvider>` and use `useSafeAreaInsets()` for top/bottom padding.

8. **No hardcoded screen widths:** Use `const { width: SCREEN_WIDTH } = Dimensions.get('window')` and calculate column widths dynamically.

---

## 🚫 THINGS TO EXPLICITLY AVOID

- Do NOT use Blinkit's neon lime-green (`#CBFF00` or similar) anywhere
- Do NOT add delivery time estimates in the header
- Do NOT add a wallet icon
- Do NOT include Electronics in the Bestsellers section
- Do NOT include Chicken / Meat / Fish in Grocery & Kitchen
- Do NOT include Paan Corner in Snacks & Drinks
- Do NOT add a Print tab to the bottom nav
- Do NOT copy Zomato's red branding — the Special button uses our own accent red `#C4383A`
- Do NOT use any emoji in production text unless specified above — use icons instead

---

## ✅ WHAT DONE LOOKS LIKE

When complete, the home screen should have:
- [ ] Orange header with `[YOUR_APP_NAME]` and cycling tagline
- [ ] Search bar with animated rotating placeholder and mic icon
- [ ] 5 category chips (All, Beauty, Grocery, Snacks, Dairy)
- [ ] Promotional banner
- [ ] Bestsellers 3-column grid (5 categories)
- [ ] Grocery & Kitchen 4-column icon grid (6 items)
- [ ] Snacks & Drinks 4-column icon grid (7 items)
- [ ] Chirawa's Special horizontal scroll with local shop cards
- [ ] Bottom nav with 4 tabs including raised red "Special" button

**Replace `[YOUR_APP_NAME]` with your actual app name before running this.**