export const SUPPORTED_PI_TASKS_LOCALES = ["en", "fr", "de", "es", "it", "pl", "ru", "jp", "cn"] as const;

export type PiTasksLocale = (typeof SUPPORTED_PI_TASKS_LOCALES)[number];

export interface PluralForms {
  one: string;
  other: string;
}

export interface CountForms {
  zero: string;
  one: string;
  other: string;
}
