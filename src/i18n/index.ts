import { cn } from "./cn.js";
import { de } from "./de.js";
import { en } from "./en.js";
import { es } from "./es.js";
import { fr } from "./fr.js";
import { it } from "./it.js";
import { jp } from "./jp.js";
import { pl } from "./pl.js";
import { ru } from "./ru.js";
import { SUPPORTED_PI_TASKS_LOCALES, type CountForms, type PiTasksLocale, type PluralForms } from "./types.js";

export { SUPPORTED_PI_TASKS_LOCALES, type CountForms, type PiTasksLocale, type PluralForms } from "./types.js";
export type LocaleMessages = typeof en;

export const DEFAULT_PI_TASKS_LOCALE: PiTasksLocale = "en";

const LOCALES = { en, fr, de, es, it, pl, ru, jp, cn } satisfies Record<PiTasksLocale, LocaleMessages>;

let localeOverride: PiTasksLocale | undefined;

export function setPiTasksLocaleOverride(locale: PiTasksLocale | undefined): void {
  localeOverride = locale;
}

export function currentPiTasksLocale(): PiTasksLocale {
  return localeOverride ?? resolvePiTasksLocale();
}

export function normalizePiTasksLocale(value: string | null | undefined): PiTasksLocale | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  const base = normalized.split(/[._-]/)[0];
  if (isSupportedPiTasksLocale(base)) return base;
  if (base === "ja") return "jp";
  if (base === "zh") return "cn";
  return undefined;
}

function isSupportedPiTasksLocale(value: string | undefined): value is PiTasksLocale {
  return value !== undefined && (SUPPORTED_PI_TASKS_LOCALES as readonly string[]).includes(value);
}

type LocaleEnv = Partial<Record<"PI_TASKS_LANG" | "LC_ALL" | "LC_MESSAGES" | "LANG", string | undefined>>;

export function resolvePiTasksLocale(env: LocaleEnv = process.env): PiTasksLocale {
  return (
    normalizePiTasksLocale(env.PI_TASKS_LANG) ??
    normalizePiTasksLocale(env.LC_ALL) ??
    normalizePiTasksLocale(env.LC_MESSAGES) ??
    normalizePiTasksLocale(env.LANG) ??
    DEFAULT_PI_TASKS_LOCALE
  );
}

export function piTasksMessages(locale: PiTasksLocale = currentPiTasksLocale()): LocaleMessages {
  return LOCALES[locale];
}

export function formatPlural(forms: PluralForms, count: number): string {
  return (count === 1 ? forms.one : forms.other).replaceAll("{count}", String(count));
}

export function formatCount(forms: CountForms, count: number): string {
  if (count === 0) return forms.zero;
  return formatPlural(forms, count);
}

export function pluralWord(forms: PluralForms, count: number): string {
  return count === 1 ? forms.one : forms.other;
}
