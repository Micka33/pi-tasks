import assert from "node:assert/strict";
import test from "node:test";
import {
  currentPiTasksLocale,
  DEFAULT_PI_TASKS_LOCALE,
  formatCount,
  formatPlural,
  normalizePiTasksLocale,
  piTasksMessages,
  pluralWord,
  resolvePiTasksLocale,
  setPiTasksLocaleOverride,
  SUPPORTED_PI_TASKS_LOCALES,
} from "../src/i18n/index.js";

test("i18n locale resolution normalizes configured and system locales", () => {
  assert.deepEqual(SUPPORTED_PI_TASKS_LOCALES, ["en", "fr", "de", "es", "it", "pl", "ru", "jp", "cn"]);
  assert.equal(DEFAULT_PI_TASKS_LOCALE, "en");
  assert.equal(normalizePiTasksLocale(undefined), undefined);
  assert.equal(normalizePiTasksLocale(null), undefined);
  assert.equal(normalizePiTasksLocale(" "), undefined);
  assert.equal(normalizePiTasksLocale("fr_FR.UTF-8"), "fr");
  assert.equal(normalizePiTasksLocale("en-US"), "en");
  assert.equal(normalizePiTasksLocale("de_DE"), "de");
  assert.equal(normalizePiTasksLocale("ja_JP"), "jp");
  assert.equal(normalizePiTasksLocale("zh_CN"), "cn");

  assert.equal(resolvePiTasksLocale({ PI_TASKS_LANG: "fr" }), "fr");
  assert.equal(resolvePiTasksLocale({ PI_TASKS_LANG: "xx", LC_ALL: "fr_CA" }), "fr");
  assert.equal(resolvePiTasksLocale({ PI_TASKS_LANG: "de", LC_ALL: "", LC_MESSAGES: "en_GB" }), "de");
  assert.equal(resolvePiTasksLocale({ PI_TASKS_LANG: "xx", LC_ALL: "", LC_MESSAGES: "", LANG: "fr_FR.UTF-8" }), "fr");
  assert.equal(resolvePiTasksLocale({ PI_TASKS_LANG: "xx", LC_ALL: "", LC_MESSAGES: "", LANG: "C.UTF-8" }), "en");
});

test("i18n runtime override takes precedence for current messages", () => {
  setPiTasksLocaleOverride(undefined);
  try {
    process.env.PI_TASKS_LANG = "en";
    assert.equal(currentPiTasksLocale(), "en");
    assert.equal(piTasksMessages().compact.listCreated, "✓ List created:");

    setPiTasksLocaleOverride("fr");
    assert.equal(currentPiTasksLocale(), "fr");
    assert.equal(piTasksMessages().compact.listCreated, "✓ Liste créée:");
  } finally {
    setPiTasksLocaleOverride(undefined);
  }
});

test("i18n messages and plural helpers expose every supported locale", () => {
  assert.equal(piTasksMessages("en").compact.listCreated, "✓ List created:");
  assert.equal(piTasksMessages("fr").compact.listCreated, "✓ Liste créée:");
  assert.equal(piTasksMessages("de").compact.listCreated, "✓ Liste erstellt:");
  assert.equal(piTasksMessages("es").compact.listCreated, "✓ Lista creada:");
  assert.equal(piTasksMessages("it").compact.listCreated, "✓ Lista creata:");
  assert.equal(piTasksMessages("pl").compact.listCreated, "✓ Lista utworzona:");
  assert.equal(piTasksMessages("ru").compact.listCreated, "✓ Список создан:");
  assert.equal(piTasksMessages("jp").compact.listCreated, "✓ リストを作成しました:");
  assert.equal(piTasksMessages("cn").compact.listCreated, "✓ 列表已创建：");

  assert.equal(formatPlural({ one: "{count} item", other: "{count} items" }, 1), "1 item");
  assert.equal(formatPlural({ one: "{count} item", other: "{count} items" }, 2), "2 items");
  assert.equal(formatCount({ zero: "none", one: "{count} item", other: "{count} items" }, 0), "none");
  assert.equal(formatCount({ zero: "none", one: "{count} item", other: "{count} items" }, 3), "3 items");
  assert.equal(pluralWord({ one: "task", other: "tasks" }, 1), "task");
  assert.equal(pluralWord({ one: "task", other: "tasks" }, 4), "tasks");
});
