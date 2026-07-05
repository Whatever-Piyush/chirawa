// Customer-facing footer. COD-only messaging and a WhatsApp help link — no
// card / UPI / wallet / online-payment references anywhere (plan §1).
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-10 border-t border-hairline bg-surface">
      <div className="mx-auto w-full max-w-content px-4 py-8 text-sm text-ink-muted">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-lg font-heavy text-primary">Bringly</p>
            <p className="mt-1">चिरावा में ताज़ा किराना, आपके दरवाज़े तक।</p>
          </div>

          <div className="flex flex-col gap-1 sm:text-right">
            <p className="inline-flex items-center gap-1 sm:justify-end">
              <span aria-hidden>💵</span> डिलीवरी पर नकद भुगतान
            </p>
            <a
              href="https://wa.me/"
              className="inline-flex items-center gap-1 text-success hover:underline sm:justify-end"
            >
              <span aria-hidden>💬</span> मदद चाहिए? WhatsApp करें
            </a>
          </div>
        </div>

        <p className="mt-6 text-xs text-ink-faint">© {year} Bringly · चिरावा</p>
      </div>
    </footer>
  );
}
