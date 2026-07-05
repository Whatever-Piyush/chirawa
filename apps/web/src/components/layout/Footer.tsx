import Link from 'next/link';

// Customer-facing footer. COD-only messaging and a WhatsApp help link — no
// card / UPI / wallet / online-payment references anywhere (plan §1).
// Bottom padding clears the mobile bottom nav.
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-12 border-t border-hairline bg-surface pb-20 md:pb-0">
      <div className="mx-auto w-full max-w-content px-4 py-10 text-sm text-ink-muted">
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <p className="text-xl font-heavy tracking-tight text-primary">Bringly</p>
            <p className="mt-1.5 leading-relaxed">
              चिरावा की अपनी दुकानों से ताज़ा किराना — मिनटों में, आपके दरवाज़े तक।
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-primary-light px-2.5 py-1 text-xs font-semibold text-primary">
                ⏱ मिनटों में डिलीवरी
              </span>
              <span className="rounded-full bg-success-light px-2.5 py-1 text-xs font-semibold text-success">
                💵 नकद भुगतान
              </span>
            </div>
          </div>

          <nav aria-label="फुटर लिंक" className="grid grid-cols-2 gap-1.5 text-sm sm:justify-self-center">
            <Link href="/" className="py-1 transition-colors hover:text-primary">होम</Link>
            <Link href="/search" className="py-1 transition-colors hover:text-primary">खोजें</Link>
            <Link href="/cart" className="py-1 transition-colors hover:text-primary">कार्ट</Link>
            <Link href="/orders" className="py-1 transition-colors hover:text-primary">मेरे ऑर्डर</Link>
            <Link href="/account" className="py-1 transition-colors hover:text-primary">मेरा अकाउंट</Link>
            <Link href="/account/addresses" className="py-1 transition-colors hover:text-primary">मेरे पते</Link>
          </nav>

          <div className="flex flex-col gap-2 sm:items-end">
            <a
              href="https://wa.me/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-success bg-success-light px-4 py-2 text-sm font-bold text-success transition-all duration-200 hover:shadow-card"
            >
              💬 मदद चाहिए? WhatsApp करें
            </a>
            <p className="text-xs leading-relaxed sm:text-right">
              रोज़ सुबह 9 बजे से रात 8 बजे तक
              <br />
              डिलीवरी सिर्फ़ चिरावा (333026) में
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-start justify-between gap-2 border-t border-divider pt-5 text-xs text-ink-faint sm:flex-row sm:items-center">
          <p>© {year} Bringly · चिरावा</p>
          <p>
            चिरावा में <span aria-hidden>❤️</span> से बनाया गया
          </p>
        </div>
      </div>
    </footer>
  );
}
