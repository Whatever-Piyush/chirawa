import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto grid w-full max-w-content place-items-center px-4 py-24 text-center">
      <div>
        <p className="text-5xl" aria-hidden>
          🧺
        </p>
        <h1 className="mt-4 text-xl font-heavy text-ink">यह पेज नहीं मिला</h1>
        <p className="mt-1 text-sm text-ink-muted">हो सकता है यह दुकान या सामान अब उपलब्ध न हो।</p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-dark"
        >
          होम पर जाएँ
        </Link>
      </div>
    </div>
  );
}
