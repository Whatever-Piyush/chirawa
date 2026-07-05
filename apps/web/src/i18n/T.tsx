'use client';

import { useT } from '@chirawa/i18n/core';

// Render a translated string inside an otherwise-server tree. `<T k="home.searchPlaceholder" />`
// is a tiny client island so pages/components can stay Server Components.
export function T({ k }: { k: string }) {
  const t = useT();
  return <>{t(k)}</>;
}
