/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Shared workspace packages ship raw TS/TSX — Next must transpile them.
  // (Only i18n needs the Task 2 web-safe refactor before it can be imported.)
  transpilePackages: ['@chirawa/api-client', '@chirawa/types', '@chirawa/i18n'],
  images: {
    // Product/shop images come from R2_PUBLIC_URL (Cloudflare R2). In dev it
    // defaults to the API origin (localhost:3000). The PROD R2/CloudFront public
    // host is a secret not in the repo — set NEXT_PUBLIC_IMAGE_HOST before Task 6
    // (still pending from product owner, plan §8).
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', port: '3000', pathname: '/**' },
      ...(process.env.NEXT_PUBLIC_IMAGE_HOST
        ? [{ protocol: 'https', hostname: process.env.NEXT_PUBLIC_IMAGE_HOST, pathname: '/**' }]
        : []),
    ],
  },
};

export default nextConfig;
