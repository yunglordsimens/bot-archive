import { cs } from "./cs.js";
import { en } from "./en.js";
import { ru } from "./ru.js";
import { vi } from "./vi.js";
import type { Dict, Forms, Lang } from "./types.js";

export type { Dict, Lang } from "./types.js";

export const DICTS: Record<Lang, Dict> = { ru, cs, en, vi };
export const LANGS = Object.keys(DICTS) as Lang[];

export const tr = (lang: string | null | undefined): Dict => DICTS[(lang as Lang) ?? "ru"] ?? ru;

// "5 пунктов" / "5 bodů" / "5 points" — Intl picks the plural form for the language.
export function plural(d: Dict, n: number, forms: Forms): string {
  const rule = new Intl.PluralRules(d.locale).select(n) as keyof Forms;
  return `${n} ${forms[rule] ?? forms.other}`;
}

export const fmtDate = (d: Dict, iso: string, withYear = false) =>
  new Date(iso).toLocaleDateString(d.locale, { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });

// All translations of one button — for matching the reply-keyboard text whatever the user's language.
export const allButtons = (key: keyof Dict["btn"]) => LANGS.map((l) => DICTS[l].btn[key]);
