// ── Shared floating-dock geometry (Track_Order.md · Placement) ───────────────
// Single source of truth for where the two bottom-floating elements — the
// CartDockPill (centred "View cart" capsule) and the LiveOrderBubble (bottom-
// right tracker) — sit, and the rule that keeps them from overlapping. Both
// components import from here so the layout can never drift apart.

export const TAB_BAR_BASE   = 64;   // CustomTabBar height (excl. safe-area)
export const GAP_ABOVE_BAR  = 10;   // breathing space above the tab bar
export const STACK_GAP      = 16;   // pushed screens (no tab bar)
export const PRODUCT_BAR    = 96;   // clear Product Detail's add-to-cart footer
export const CART_PILL_HEIGHT = 48; // CartDockPill height
export const CART_PILL_GAP    = 10; // gap between the pill and the bubble above it

// ── CartDockPill route logic (moved verbatim from CartDockPill) ──────────────
// Bottom-tab routes the pill floats above. (Food is intentionally excluded — it
// has its own cart, so the marketplace "View cart" pill does not show there.)
export const CART_TAB_ROUTES = new Set<string>([
  'Home', 'OrderHistory', 'Categories', 'Special', 'Profile',
]);

// The "View cart" capsule belongs only on browse/shop surfaces. An ALLOWLIST
// keeps it off every transactional/utility flow by default.
export const CART_PILL_ROUTES = new Set<string>([
  ...CART_TAB_ROUTES,
  'ProductDetail', 'ShopDetail', 'CategoryProducts', 'Search',
]);

// Is the CartDockPill currently on-screen? Undefined route = first paint on Home.
export function cartPillVisible(activeRoute: string | undefined, cartCount: number): boolean {
  return cartCount > 0 && CART_PILL_ROUTES.has(activeRoute ?? 'Home');
}

// ── LiveOrderBubble route logic ──────────────────────────────────────────────
// Tab screens where a tab bar is present (drives the bubble's bottom offset).
// Unlike the cart pill, the bubble DOES ride on Food (it tracks the customer's
// live orders regardless of which store surface they're browsing).
export const BUBBLE_TAB_ROUTES = new Set<string>([
  'Home', 'OrderHistory', 'Categories', 'Special', 'Food', 'Profile',
]);

// Surfaces the bubble may appear on. Deliberately excludes the Search modal,
// checkout/order-placed, address flows, auth, and the tracking screens (where a
// floating tracker is redundant or distracting).
export const BUBBLE_ROUTES = new Set<string>([
  ...BUBBLE_TAB_ROUTES,
  'ProductDetail', 'ShopDetail', 'CategoryProducts',
]);

export function isBubbleTabRoute(activeRoute: string | undefined): boolean {
  return !activeRoute || BUBBLE_TAB_ROUTES.has(activeRoute);
}

// Bubble bottom offset: above the tab bar on tab screens, above the add-to-cart
// bar on Product Detail, otherwise a small stack gap — then lifted a full pill
// row when the cart pill is also visible so the two never collide.
export function bubbleBottomOffset(
  activeRoute: string | undefined,
  insetBottom: number,
  cartLifted: boolean,
): number {
  const base = isBubbleTabRoute(activeRoute)
    ? insetBottom + TAB_BAR_BASE + GAP_ABOVE_BAR
    : activeRoute === 'ProductDetail'
      ? insetBottom + PRODUCT_BAR
      : insetBottom + STACK_GAP;
  return cartLifted ? base + CART_PILL_HEIGHT + CART_PILL_GAP : base;
}
