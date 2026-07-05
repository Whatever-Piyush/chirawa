// Money is stored in paise (₹1 = 100 paise) everywhere. Display as ₹ with Indian
// digit grouping; show decimals only when there are stray paise.
export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  const hasPaise = Math.round(paise) % 100 !== 0;
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

// Discount percentage of a sale price vs its MRP (rounded). Returns 0 when there
// is no genuine discount (missing/zero MRP, or MRP <= price).
export function discountPercent(pricePaise: number, mrpPaise: number | null | undefined): number {
  if (!mrpPaise || mrpPaise <= pricePaise) return 0;
  return Math.round(((mrpPaise - pricePaise) / mrpPaise) * 100);
}
