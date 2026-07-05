// Loading placeholders for the home Suspense boundaries.

export function ShelfSkeleton({ title }: { title?: string }) {
  return (
    <section className="mt-8">
      {title ? <div className="mb-3 h-5 w-40 rounded bg-surface-alt" /> : null}
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="w-36 shrink-0 animate-pulse rounded-lg border border-hairline bg-surface p-2.5">
            <div className="mb-2 aspect-square rounded-md bg-surface-alt" />
            <div className="h-3 w-3/4 rounded bg-surface-alt" />
            <div className="mt-2 h-3 w-1/2 rounded bg-surface-alt" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function GridSkeleton() {
  return (
    <section className="mt-8">
      <div className="mb-3 h-5 w-32 rounded bg-surface-alt" />
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex animate-pulse flex-col items-center gap-1.5">
            <div className="h-16 w-16 rounded-full bg-surface-alt" />
            <div className="h-3 w-12 rounded bg-surface-alt" />
          </div>
        ))}
      </div>
    </section>
  );
}
