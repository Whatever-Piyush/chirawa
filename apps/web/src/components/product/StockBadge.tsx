// Out-of-stock overlay badge for product tiles/cards (shop + search + PDP).
export function StockBadge() {
  return (
    <span className="absolute inset-0 grid place-items-center rounded-md bg-black/50">
      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">
        स्टॉक ख़त्म
      </span>
    </span>
  );
}
