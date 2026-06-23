/** Human labels for the language codes sources expose. */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ru: 'Русский',
  fr: 'Français',
  es: 'Español',
  'es-la': 'Español (LatAm)',
  de: 'Deutsch',
  'pt-br': 'Português (BR)',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
  'zh-hk': '中文 (HK)',
  pl: 'Polski',
  tr: 'Türkçe',
  vi: 'Tiếng Việt',
  id: 'Bahasa',
  ar: 'العربية',
  th: 'ไทย',
  uk: 'Українська',
};

export const languageLabel = (code: string): string => LANGUAGE_NAMES[code] ?? code.toUpperCase();
