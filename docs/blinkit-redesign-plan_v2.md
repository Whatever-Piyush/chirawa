# Claude Code Task — Part 2: Order Again, Profile Screen, Nav Bar & Cart Capsule

## Context
you already have the access to the code file and you know what we have built till now 

i am giving you the instruction don't follow blindly just take this as a reference but if you know better that these instruction do that also if you found the instruction is not that much good for a particular thing you can use you higher intleligence to tackel that but the overall thing i want from you is this 
the file name and other thing this prompt include don't means anything you have to find the relevant file to make the changes and impelement things beacuse this prompt don't include the context of our project but the idea that we want to make is there 

---

## 📁 Files to Create or Modify

- `src/screens/OrderAgainScreen.tsx` — new screen
- `src/screens/ProfileScreen.tsx` — new screen
- `src/components/layout/BottomNav.tsx` — **REPLACE** previous version entirely
- `src/components/cart/FloatingCartCapsule.tsx` — new component
- `src/components/cart/FlyToCartAnimation.tsx` — new component
- `src/components/product/ProductCard.tsx` — new component (used in Order Again + category screens)
- `src/context/CartContext.tsx` — create if not already present (manages cart state globally)

---

## 🛒 FEATURE 1 — ORDER AGAIN SCREEN

**File:** `src/screens/OrderAgainScreen.tsx`

This screen is reached from the bottom nav "Order Again" tab.

### Empty State (no previous orders)

When `orders.length === 0`:

```
Background: COLORS.background (warm cream)

Center of screen (vertically centered):
  - Illustration placeholder: a large rounded square (200×200),
    backgroundColor: '#FFF0E9', borderRadius: 20,
    containing a shopping bag icon (MaterialCommunityIcons 'shopping-outline', 80px, color: COLORS.primary)
  - Below illustration (20px gap):
    "Reordering will be easy"
    font: Poppins SemiBold, 20px, color: COLORS.textPrimary, textAlign: center
  - Below that (8px gap):
    "Items you order will show up here\nso you can buy them again easily"
    font: Poppins Regular, 14px, color: COLORS.textSecondary, textAlign: center, lineHeight: 22
  - Below that (24px gap):
    A CTA button: "Browse products →"
    backgroundColor: COLORS.primary, borderRadius: 24, paddingHorizontal: 28, paddingVertical: 12
    font: Poppins SemiBold, 14px, color: white
    On press: navigate to Categories or Home screen
```

### Filled State (past orders exist)

When orders are present, show a section titled **"Order Again"** (Poppins Bold 20px) followed by a scrollable product grid.

**Product Card Component** (also used across the app — build this as `src/components/product/ProductCard.tsx`):

Each card: width = (SCREEN_WIDTH - 32 - 12) / 2 (2-column grid), height ~260px.

```
Card structure (top to bottom):

┌─────────────────────────┐
│  [🟢 or 🔴] veg/nonveg │  ← top-left corner of card (8px from edges)
│                         │
│   [Product Image]       │  ← 120px tall image area, bg: #F8F8F8
│                         │
│   ───────────────────── │
│   250g                  │  ← weight/size: Poppins Regular 12px, COLORS.textSecondary
│                    [ADD]│  ← ADD button, right-aligned
│                         │
│   ₹45                   │  ← price: Poppins Bold 16px, COLORS.textPrimary
│   ₹50 ~~strikethrough~~ │  ← MRP if discount exists: 12px, #999, textDecorationLine: 'line-through'
│   Amul Butter 250g      │  ← name: Poppins Medium 13px, textPrimary, 2 lines max
└─────────────────────────┘
```

**Veg / Non-Veg Indicator:**
- A small square (14×14px), borderRadius 2, borderWidth 1.5
- Veg: borderColor '#1A7A2A', backgroundColor '#FFFFFF', with an inner filled circle (8×8, borderRadius 4, backgroundColor '#1A7A2A') centered inside
- Non-veg: same but all colors '#B71C1C'
- Position: `position: 'absolute', top: 8, left: 8, zIndex: 2`
- Default to veg (green) unless product has `isNonVeg: true` in data

**ADD Button (this is the core interactive element — get this right):**

States and transitions:

**State 1 — "ADD" (item not in cart):**
- A pill-shaped button: `borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 20`
- Width: 72px, Height: 32px
- Text: "ADD", Poppins Bold, 14px, color: COLORS.primary
- Background: white

**State 2 — Quantity Selector (item in cart):**
When ADD is pressed, animate the button morphing into a stepper:
- Use `Animated.timing` to expand width from 72px to 100px over 150ms
- Background changes from white to COLORS.primary
- Content becomes: `[-]  [count]  [+]` — white text/icons
- The [-] and [+] are `TouchableOpacity` zones (left third and right third of the button)
- Center shows the count number, Poppins Bold, 14px, white
- On press [-]: decrement count; if count reaches 0, animate back to State 1

**ADD press triggers FlyToCartAnimation** (see Feature 4 below).

**Product grid:** Use `FlatList` with `numColumns={2}`, `columnWrapperStyle={{ gap: 12 }}`, `contentContainerStyle={{ padding: 16, gap: 12 }}`.

---

## 👤 FEATURE 2 — PROFILE / ACCOUNT SCREEN

**File:** `src/screens/ProfileScreen.tsx`

### Header Section
Full-width gradient header (use `expo-linear-gradient` from `['#FFE0B2', '#FFF5EE']`, top to bottom).
Height: 220px (includes safe area top).

Layout:
```
[← Back]      Profile        (no right icon)

        [Avatar Circle]
       "Your account"
       +91 98765XXXXX         ← user's phone number
```

- Back arrow: Ionicons `arrow-back`, 24px, color `#333`, left 16px
- Avatar: circular container, diameter 80px, `backgroundColor: '#E0E0E0'`, `borderRadius: 40`, centered horizontally
  - Inside: Ionicons `person`, 44px, color `#999`
  - If user has a profile photo, show `<Image>` instead
  - A small edit badge (pencil icon, 20×20px circle, backgroundColor: COLORS.primary) positioned bottom-right of avatar
- "Your account": Poppins Bold, 22px, `#1A1A2E`, marginTop 12
- Phone number: Poppins Regular, 14px, COLORS.textSecondary, marginTop 4

### Birthday Banner
Full-width card (margin 16px, borderRadius 14):
- `backgroundColor: '#FFF8E1'`, `borderColor: '#FFE082'`, `borderWidth: 1`
- Left text: "Add your birthday" (Poppins SemiBold, 14px, textPrimary) + "Get a surprise gift 🎁" (12px, textSecondary)
- Right: a cake emoji illustration (use a Text with '🎂' at 40px fontSize, or an icon)
- On press: open a birthday date picker modal

### Quick Action Tiles (3-column row)
Margin: 16px horizontal. Gap: 12px.

**Include only these 2 tiles** (⚠️ DO NOT include Blinkit Money):
```
┌──────────────┐  ┌──────────────┐
│    [icon]    │  │    [icon]    │
│  Your orders │  │  Need help?  │
└──────────────┘  └──────────────┘
```
Each tile:
- `backgroundColor: COLORS.surface`, `borderRadius: 14`, `borderWidth: 1`, `borderColor: COLORS.border`
- Width: (SCREEN_WIDTH - 32 - 12) / 2 (equal halves)
- Height: 90px
- Icon (MaterialCommunityIcons): `shopping-outline` (32px, COLORS.primary) for orders; `headset` (32px, COLORS.primary) for help
- Label: Poppins Medium, 13px, textPrimary, marginTop 8
- On press: navigate to Orders screen / Help screen

### Appearance Row
Thin card (margin 16px, borderRadius 14, bg: COLORS.surface, borderWidth 1, borderColor: COLORS.border):
```
☀️  Appearance                    LIGHT  ▾
```
- Row: `flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16`
- Left: sun icon (Ionicons `sunny-outline`, 20px, #F4A261) + "Appearance" (Poppins Medium, 14px)
- Right: current mode label (LIGHT/DARK in COLORS.primary) + chevron down
- On press: show `ActionSheet` with Light / Dark / System options
- Wire up to a `ThemeContext` or `AsyncStorage` preference

### Your Information Section
Section header: "Your information" (Poppins SemiBold, 16px, textPrimary, padding 16px left, marginTop 8)

List items (each row):
- `backgroundColor: COLORS.surface, padding: 16, borderBottomWidth: 0.5, borderBottomColor: COLORS.border`
- Left: icon (20px, color: `#777`) + label (Poppins Regular, 14px, textPrimary), gap 14px
- Right: `>` chevron (Ionicons `chevron-forward`, 18px, `#bbb`)

**Include these rows in this order:**
```
📖  Address book               >
❤️  Your wishlist              >
📋  GST details                >
🎁  Your collected rewards     >
```

⚠️ **DO NOT include:** Bookmarked recipes, Notification preferences

### Other Information Section
Section header: "Other Information" (same style)

```
↑   Share the app              >
ℹ️  About us                   >
🏪  List your shop             >   ← (replaces "Sell on Blinkit")
🔒  Account privacy            >
🚪  Log out                    >   ← make this row text color: '#E53935' (red)
```

**"List your shop" row** — this opens an onboarding flow for local Chirawa vendors to register. Style it slightly differently:
- Row bg: `#FFF3E0` (warm highlight)
- Icon color: COLORS.accent
- Text color: COLORS.accent (makes it stand out as a CTA)

### App Version Footer
At the very bottom, centered, after all sections:
- App name in Poppins Bold, 16px, color `#CCC`
- `"v1.0.0"` in 12px, `#BBB`
- marginBottom: 40px

---

## ✨ FEATURE 3 — BOTTOM NAV REDESIGN (Full Replacement)

**File:** `src/components/layout/BottomNav.tsx`

**⚠️ This completely replaces the previous bottom nav spec from Part 1.**
The previous icons were too generic. This version uses a premium "pill indicator" design system.

### Design Philosophy
- Active tab: the icon gets a soft **colored pill/blob** behind it (not just a color change)
- Labels always visible (active: primary color, inactive: `#9CA3AF`)
- Smooth spring animation on tab switch
- The Chirawa's Special button is a floating raised pill (same as Part 1, now with better icon)
- Icon library: **MaterialCommunityIcons** (much richer than basic Ionicons)

### Structure
```
[  Home  ]  [ Order Again ]  [ Categories ]  [★ Special]
```

Height: 64px + `useSafeAreaInsets().bottom`
Background: `#FFFFFF`
Top: `borderTopWidth: 0.5, borderTopColor: '#F0E0D6'`
Shadow: `elevation: 12`, iOS: `shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: {width: 0, height: -2}`

### Tab Config Array
```ts
const TABS = [
  {
    key: 'home',
    label: 'Home',
    iconActive: 'home',           // MaterialCommunityIcons
    iconInactive: 'home-outline',
    pillColor: '#FFF0E9',         // soft saffron pill
    activeIconColor: COLORS.primary,
  },
  {
    key: 'orderAgain',
    label: 'Order Again',
    iconActive: 'refresh-circle',
    iconInactive: 'refresh',
    pillColor: '#E8F5E9',
    activeIconColor: '#2E7D32',
  },
  {
    key: 'categories',
    label: 'Categories',
    iconActive: 'view-grid',
    iconInactive: 'view-grid-outline',
    pillColor: '#EDE7F6',
    activeIconColor: '#5E35B1',
  },
  // Chirawa's Special is rendered separately (not in this array)
];
```

### Regular Tab Render (for first 3 tabs)
```tsx
// Each tab: flex: 1, alignItems: 'center', justifyContent: 'center'
// Gap between pill and label: 2px

// The pill: position: 'absolute' behind the icon
// width: 48px, height: 28px, borderRadius: 14
// backgroundColor: tab.pillColor
// Animates opacity 0→1 and scaleX 0.6→1 using Animated.spring when this tab becomes active

// Icon: MaterialCommunityIcons, size: 24px
// Active color: tab.activeIconColor
// Inactive color: '#9CA3AF'

// Label: Poppins Medium, 10px
// Active: tab.activeIconColor
// Inactive: '#9CA3AF'
```

Animate tab transitions with `Animated.spring({ tension: 300, friction: 20 })`.

### Chirawa's Special Button (4th position)
This is NOT a regular tab. It's a raised pill button:
```
width: 86px, height: 46px
backgroundColor: COLORS.accent  (#C4383A)
borderRadius: 14
marginTop: -10px  ← lifts it above the tab bar
elevation: 8
iOS shadow: shadowColor: '#C4383A', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: {width: 0, height: -2}
```

Inside the button (centered column):
- Icon: MaterialCommunityIcons `star-four-points` or `sparkles`, 20px, white
- Label: "Special", Poppins Bold, 10px, white, marginTop: 1

On active state: add a white `borderWidth: 2, borderColor: rgba(255,255,255,0.4)` ring inside the button.

Active/inactive: the button always shows (it's always "special"), but when active, the icon is `star-four-points` (filled); when on this tab, the background slightly lightens to `#D4424A`.

### Tab Switch Behavior
- Use `React.useState` for `activeTab`
- On tab press, run `Animated.spring` to animate the pill on the new active tab
- On tab press also trigger `Animated.sequence([Animated.timing(scale, {toValue: 0.85, duration: 80}), Animated.timing(scale, {toValue: 1, duration: 120})])` for a subtle "press bounce" on the icon

---

## 🛍️ FEATURE 4 — FLOATING CART CAPSULE + FLY-TO-CART ANIMATION

This is the most animation-heavy feature. Take extra care with performance — use `useNativeDriver: true` wherever possible.

### 4A — FloatingCartCapsule Component

**File:** `src/components/cart/FloatingCartCapsule.tsx`

This capsule floats above the bottom nav bar whenever `cartItemCount > 0`.
Position: `absolute, bottom: 70 + safeAreaBottom, left: 16, right: 16` (so it sits just above the nav).

**Capsule spec:**
```
Height: 56px
borderRadius: 28 (perfect pill)
backgroundColor: '#1A1A2E'  (deep navy-black, NOT primary orange — gives premium dark contrast)
paddingHorizontal: 8

Layout (horizontal, space-between):
[Left]  [product thumbnail]  [item count + "View cart"]  →  [Right arrow zone]
```

**Left zone (48px wide):**
- A 40×40px square with borderRadius 10
- Shows the most recently added product image (placeholder: colored rounded square)
- backgroundColor: '#2A2A3E' as fallback
- A small orange dot badge in top-right corner of this image (12px diameter circle, bg: COLORS.primary) showing item count if > 1

**Center zone (flex: 1):**
```
"View cart"     ← Poppins SemiBold, 15px, white
"3 items · ₹136"  ← Poppins Regular, 12px, rgba(255,255,255,0.65)
```
The total price and count animate (using `Animated.timing` + number interpolation) when the count changes.

**Right zone (40px wide):**
- Ionicons `arrow-forward`, 20px, white
- Slight right padding: 8px

**Appearance animation:**
When capsule first appears (goes from `cartItemCount: 0 → 1`):
```ts
// Slide up from bottom + fade in
translateY: Animated.spring from 80 → 0, tension: 200, friction: 18
opacity: Animated.timing from 0 → 1, duration: 200
```

When capsule disappears (cart emptied):
```ts
// Slide down + fade out
translateY: Animated.timing to 80, duration: 200
opacity: Animated.timing to 0, duration: 200
// THEN call setState to unmount
```

**Count change animation:**
When item count changes, do a small "bump" scale:
```ts
Animated.sequence([
  Animated.timing(scale, {toValue: 1.04, duration: 60}),
  Animated.spring(scale, {toValue: 1, tension: 300, friction: 10})
])
```

### 4B — Fly-to-Cart Animation

**File:** `src/components/cart/FlyToCartAnimation.tsx`

When the user presses ADD on a product, a small copy of the product image "flies" from the card position to the cart capsule.

**How to implement:**

This requires knowing the screen coordinates of:
1. The ADD button (source position)
2. The cart capsule (destination position)

**Step 1:** In `ProductCard.tsx`, when ADD is pressed:
```ts
// Use a ref on the product image:
const imageRef = useRef(null);
imageRef.current.measureInWindow((x, y, width, height) => {
  // x, y = top-left corner of product image on screen
  // Call the fly animation with these coords
  triggerFlyAnimation({ x: x + width/2, y: y + height/2 });
});
```

**Step 2:** `FlyToCartAnimation` renders an `Animated.View` (absolutely positioned on the root view level) with:
- A 48×48px colored square (matching the product image placeholder, borderRadius 10)
- Starts at: `{ top: sourceY, left: sourceX - 24 }` (centered on the source)
- Destination: `{ top: SCREEN_HEIGHT - 90 - safeAreaBottom, left: 24 }` (where the capsule thumbnail is)

**Animation path (curved arc):**
Use `Animated.parallel` for x and y, but give y a slight "arc" effect by animating through an intermediate point:
```ts
Animated.parallel([
  Animated.timing(flyX, {
    toValue: destX,
    duration: 500,
    easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
    useNativeDriver: true,
  }),
  Animated.sequence([
    // Arc up slightly first, then down to cart
    Animated.timing(flyY, {
      toValue: sourceY - 60,  // arc apex
      duration: 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }),
    Animated.timing(flyY, {
      toValue: destY,
      duration: 300,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }),
  ]),
  // Scale down as it reaches the cart
  Animated.timing(flyScale, {
    toValue: 0.3,
    duration: 500,
    easing: Easing.in(Easing.quad),
    useNativeDriver: true,
  }),
  // Fade out near the end
  Animated.timing(flyOpacity, {
    toValue: 0,
    duration: 500,
    delay: 350,
    useNativeDriver: true,
  }),
])
```

After the animation completes (in `.start(() => {...})`):
- Remove the flying element
- Trigger the capsule "bump" scale animation
- Update cart count in `CartContext`

**Implementation notes:**
- Render the `FlyToCartAnimation` at the root level of your app (in `App.tsx` or a `Portal`), positioned absolutely so it appears above all other components
- Use a `FlyAnimationContext` or pass a `ref` from the root that product cards can call
- Keep a queue: if user rapidly presses ADD on multiple items, run animations sequentially (300ms delay between each)

### 4C — CartContext

**File:** `src/context/CartContext.tsx`

```ts
interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  imageColor: string;  // placeholder color until real images are added
  isNonVeg?: boolean;
}

interface CartContextType {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, qty: number) => void;
  totalItems: number;
  totalPrice: number;
  lastAddedItem: CartItem | null;  // used by FlyAnimation to know which image to animate
}
```

Wrap the app root in `<CartProvider>` so the capsule and all product cards share the same state.

---

## 🎨 Design Consistency Notes

**Typography reminder** (Poppins throughout):
- Screen titles: Bold 20px
- Section headers: SemiBold 18px
- Card titles: Medium 13-14px
- Price: Bold 16px
- Labels/secondary: Regular 12px
- Nav labels: Medium 10px

**Spacing system:** Use multiples of 4 — gaps of 4, 8, 12, 16, 20, 24px.

**Border radius system:**
- Pills / buttons: 20-28px
- Cards: 14-16px
- Tiles / chips: 12px
- Image containers: 10-12px
- Veg indicator: 2px (square-ish)

**Shadow system:**
- Light (cards): `elevation: 2`, iOS `shadowOpacity: 0.06`
- Medium (capsule, tiles): `elevation: 4-6`, iOS `shadowOpacity: 0.10`
- Heavy (floating capsule, Special button): `elevation: 8-12`, iOS `shadowOpacity: 0.16`

---

## ✅ WHAT DONE LOOKS LIKE

- [ ] Order Again screen: empty state + product grid with veg/non-veg dots
- [ ] ProductCard component with ADD → stepper transition (no page reload, pure animation)
- [ ] Profile screen: header gradient, 2 quick tiles, all sections with correct inclusions/exclusions
- [ ] "List your shop" row styled distinctly in accent color
- [ ] Bottom nav: pill indicator design, MaterialCommunityIcons, spring animations
- [ ] Chirawa's Special button: raised, maroon, `star-four-points` icon, presses with bounce
- [ ] FloatingCartCapsule: slides up when first item added, dark navy pill, bumps on count change
- [ ] Fly-to-cart animation: product image arcs from card to capsule when ADD is pressed
- [ ] CartContext: shared across all screens

## ⚠️ Things to Explicitly NOT Include
- No "Blinkit Money" tile on profile
- No "Feeding India" section on profile
- No "Notification preferences" row on profile
- No "Print" tab in bottom nav
- No neon green colors anywhere
- No `useNativeDriver: false` on transform/opacity animations (always use native driver for performance)