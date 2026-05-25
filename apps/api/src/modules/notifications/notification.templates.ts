// ── Customer notifications ────────────────────────────────────────────────────

export const CustomerNotifications = {
  orderConfirmed: (shopName: string) => ({
    title: '✅ Order Confirm Ho Gaya!',
    body:  `${shopName} aapka order taiyar kar rahi hai. Thodi der mein rider aayega.`,
  }),

  riderAssigned: (riderName: string) => ({
    title: '🚴 Rider Aa Raha Hai!',
    body:  `${riderName} aapka order pick karne nikal gaya.`,
  }),

  orderPickedUp: () => ({
    title: '📦 Order Uthaa Liya!',
    body:  'Rider aapka order le chuka hai. Raste mein hai.',
  }),

  outForDelivery: (eta: string) => ({
    title: '🚴 Raste Mein Hai!',
    body:  `Rider ${eta} mein pahunchega. Darwaza khula rakhein!`,
  }),

  orderDelivered: () => ({
    title: '🎉 Order Pahunch Gaya!',
    body:  'Delivery complete! Umeed hai aapko pasand aaya. Dobara order karein!',
  }),

  orderCancelled: () => ({
    title: '❌ Order Cancel Ho Gaya',
    body:  'Aapka order cancel ho gaya. Refund 1-3 din mein wapas aayega.',
  }),

  paymentRefunded: (amount: number) => ({
    title: '💰 Refund Aa Gaya!',
    body:  `₹${Math.round(amount / 100)} aapke account mein wapas bhej diya. 1-3 din lagenge.`,
  }),

  walletCredited: (amount: number, reason: string) => ({
    title: '💰 Wallet Mein Credit!',
    body:  `₹${Math.round(amount / 100)} aapke wallet mein add ho gaya. ${reason}`,
  }),
};

// ── Seller notifications ──────────────────────────────────────────────────────

export const SellerNotifications = {
  newOrder: (amount: number) => ({
    title: '🔔 Naya Order Aaya!',
    body:  `₹${Math.round(amount / 100)} ka naya order! Abhi accept karein.`,
  }),

  riderArrived: (riderName: string) => ({
    title: '🚴 Rider Aa Gaya!',
    body:  `${riderName} order pick karne pahunch gaya. Order ready karein.`,
  }),

  settlementPaid: (amount: number) => ({
    title: '💰 Payment Aa Gaya!',
    body:  `Aaj ka ₹${Math.round(amount / 100)} aapke account mein transfer ho gaya!`,
  }),

  orderCancelled: (orderId: string) => ({
    title: '❌ Order Cancel Hua',
    body:  `Order #${orderId.slice(-6).toUpperCase()} cancel ho gaya. Koi item prepare mat karein.`,
  }),
};

// ── Rider notifications ───────────────────────────────────────────────────────

export const RiderNotifications = {
  newAssignment: (shopName: string, amount: number, paymentMethod: string) => ({
    title: '📦 Nayi Delivery!',
    body:  `${shopName} se ₹${Math.round(amount / 100)} ki delivery. ${paymentMethod === 'cod' ? 'COD - cash lena hai.' : 'Online payment hua hai.'} 60 seconds mein accept karein!`,
  }),

  orderCancelled: () => ({
    title: '❌ Order Cancel Hua',
    body:  'Yeh order cancel ho gaya. App open karein.',
  }),
};
