import { fa, type Dictionary } from './fa';
import { en } from './en';

export type Language = 'fa' | 'en';

export const dictionaries: Record<Language, Dictionary> = { fa, en };

export const isRtlLanguage = (lang: Language) => lang === 'fa';

type Params = Record<string, string | number>;

/** Replaces `{{key}}` placeholders in a translated string. */
export function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

export type { Dictionary };
export { fa, en };
