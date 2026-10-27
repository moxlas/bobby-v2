import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import en from '../locales/en.json';
import lt from '../locales/lt.json';

export type Language = 'en' | 'lt';

const messages: Record<Language, any> = { en, lt };

const isDev = (import.meta as any).env?.DEV === true;

function lookup(lang: Language, key: string): any {
  const keys = key.split('.');
  let value: any = messages[lang];
  for (const k of keys) {
    if (value == null) return undefined;
    value = value[k];
  }
  return value;
}

/** Resolve a key in `lang`, falling back to English when it is missing. */
function resolve(lang: Language, key: string): any {
  const value = lookup(lang, key);
  if (value !== undefined) return value;
  if (lang !== 'en' && isDev) {
    console.warn(`[i18n] missing "${key}" in "${lang}" - falling back to "en"`);
  }
  return lookup('en', key);
}

function format(value: string, replacements?: Record<string, string | number>): string {
  if (!replacements) return value;
  return value.replace(/\{(\w+)\}/g, (_, prop) => String(replacements[prop] ?? `{${prop}}`));
}

export function translate(lang: Language, key: string, replacements?: Record<string, string | number>): string {
  const value = resolve(lang, key);
  if (typeof value !== 'string') {
    if (isDev) console.warn(`[i18n] key "${key}" is missing in every locale`);
    return key;
  }
  return format(value, replacements);
}

/**
 * Translate a key whose text depends on a count.
 *
 * Looks for `${key}_${category}` (e.g. `cards_few` for 3 in Lithuanian),
 * then `${key}_other`, then the bare `${key}`. `{count}` is always available
 * to the placeholder formatter, so callers do not have to repeat it.
 */
export function translatePlural(
  lang: Language,
  key: string,
  count: number,
  replacements?: Record<string, string | number>,
): string {
  const category = new Intl.PluralRules(lang).select(count);
  const candidates = [`${key}_${category}`, `${key}_other`, key];

  for (const candidate of candidates) {
    const value = lookup(lang, candidate);
    if (typeof value === 'string') {
      return format(value, { ...replacements, count });
    }
  }

  for (const candidate of candidates) {
    const value = lookup('en', candidate);
    if (typeof value === 'string') {
      if (lang !== 'en' && isDev) {
        console.warn(`[i18n] plural key "${candidate}" missing in "${lang}" - falling back to "en"`);
      }
      return format(value, { ...replacements, count });
    }
  }

  if (isDev) console.warn(`[i18n] plural key "${key}" is missing in every locale`);
  return key;
}

export function translateArray(lang: Language, key: string): any[] {
  const value = resolve(lang, key);
  return Array.isArray(value) ? value : [];
}

export const LANGUAGES: { code: Language; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'lt', name: 'Lietuvių' },
];

const LANGUAGE_STORAGE_KEY = 'bobby-language';

export function loadLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === 'en' || saved === 'lt') return saved;
  } catch {}
  return 'en';
}

export function saveLanguage(lang: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {}
}

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, replacements?: Record<string, string | number>) => string;
  tPlural: (key: string, count: number, replacements?: Record<string, string | number>) => string;
  tArray: (key: string) => any[];
}

const I18nContext = createContext<I18nContextType>({
  language: 'en',
  setLanguage: () => {},
  t: (key) => key,
  tPlural: (key, count) => `${count}`,
  tArray: () => [],
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(loadLanguage);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    saveLanguage(lang);
  };

  const t = (key: string, replacements?: Record<string, string | number>) =>
    translate(language, key, replacements);

  const tPlural = (key: string, count: number, replacements?: Record<string, string | number>) =>
    translatePlural(language, key, count, replacements);

  const tArray = (key: string) =>
    translateArray(language, key);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <I18nContext.Provider value={{ language, setLanguage, t, tPlural, tArray }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  return useContext(I18nContext);
}
