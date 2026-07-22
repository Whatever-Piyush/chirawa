import type { MetadataRoute } from 'next';

// Catalog pages (home/shop/product) are indexable; transactional and private
// surfaces are not. /search also carries a noindex meta.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/cart', '/checkout', '/order/', '/orders', '/account', '/login', '/search', '/api/'],
      },
    ],
  };
}
