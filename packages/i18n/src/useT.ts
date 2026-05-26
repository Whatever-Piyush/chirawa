import { useLanguage } from './LanguageContext';
import { translations } from './translations';

export function useT(): (key: string) => string {
  const { language } = useLanguage();

  return (key: string): string => {
    const parts = key.split('.');
    let node: Record<string, unknown> = translations as unknown as Record<string, unknown>;

    for (const part of parts) {
      const child: unknown = node[part];
      if (child == null || typeof child !== 'object') return key;
      node = child as Record<string, unknown>;
    }

    const val: unknown = node[language];
    if (typeof val === 'string') return val;

    const fallback: unknown = node['en'];
    return typeof fallback === 'string' ? fallback : key;
  };
}
