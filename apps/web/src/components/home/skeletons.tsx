// Loading placeholders for the home Suspense boundaries (shimmer sweep).

export function ShelfSkeleton({ title }: { title?: string }) {
  return (
    <section className="mt-10">
      {title ? <div className="skeleton mb-4 h-6 w-40" /> : null}
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="w-36 shrink-0 rounded-2xl border border-hairline bg-surface p-2.5">
            <div className="skeleton mb-2 aspect-square rounded-xl" />
            <div className="skeleton h-3 w-3/4" />
            <div className="skeleton mt-2 h-3 w-1/2" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function GridSkeleton() {
  return (
    <section className="mt-10">
      <div className="skeleton mb-4 h-6 w-32" />
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className="skeleton h-16 w-16 rounded-full sm:h-20 sm:w-20" />
            <div className="skeleton h-3 w-12" />
          </div>
        ))}
      </div>
    </section>
  );
}
