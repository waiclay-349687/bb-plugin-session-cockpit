import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DISPLAY, DEFAULT_ORDER, LEGACY_PREFS, PREFS_KEY, decodePrefs, displayValue, effectiveSectionLanguage, loadPrefs, moveSection } from "../lib/cockpit-prefs.ts";
import { matchingProse } from "../lib/i18n.ts";
import { meterTone } from "../lib/palette.ts";

test("板块只接收已知唯一项，缺失项按默认顺序补齐", () => {
  const prefs = decodePrefs({ order: ["scripts", "obsolete", "environment", "scripts"], hidden: ["context", "context", null], open: ["usage"] });
  assert.deepEqual(prefs.order, ["scripts", "environment", ...DEFAULT_ORDER.filter(id => id !== "scripts" && id !== "environment")]);
  assert.deepEqual(prefs.hidden, ["context"]);
  assert.deepEqual(prefs.open, ["usage"]);
  assert.deepEqual(decodePrefs(null).order, DEFAULT_ORDER);
});

test("读取 v6 保留显隐和展开，读取更早版本沿用旧迁移规则", () => {
  const old = JSON.stringify({ hidden: ["environment"], open: ["progress"], hostStyles: { cardMotion: false } });
  const read = (key: string, fallback: string) => key === PREFS_KEY ? "{invalid" : key === fallback ? old : null;
  const v6 = loadPrefs(key => read(key, LEGACY_PREFS[0]));
  assert.deepEqual(v6.open, ["progress"]);
  assert.deepEqual(v6.hidden, ["environment"]);
  assert.deepEqual(v6.order, DEFAULT_ORDER);
  assert.deepEqual(v6.display, DEFAULT_DISPLAY);
  assert.equal(v6.hostStyles.cardMotion, false);
  assert.deepEqual(loadPrefs(key => read(key, LEGACY_PREFS[1])).open, []);
});

test("板块可跨组移动，越界或无效移动保留原顺序", () => {
  const end = DEFAULT_ORDER.length - 1;
  assert.equal(moveSection(DEFAULT_ORDER, "environment", end)[end], "environment");
  assert.deepEqual(moveSection(DEFAULT_ORDER, "progress", 0).slice(0, 3), ["progress", "environment", "context"]);
  assert.equal(moveSection(DEFAULT_ORDER, "sideChats", 1)[1], "sideChats");
  assert.deepEqual(moveSection(DEFAULT_ORDER, "context", -1), DEFAULT_ORDER);
  assert.deepEqual(moveSection(DEFAULT_ORDER, "context", 1.5), DEFAULT_ORDER);
  assert.deepEqual(moveSection(["usage"], "context", 0), ["usage"]);
  assert.equal(DEFAULT_ORDER[0], "environment");
});

test("仅覆盖进度时中文速览可显示，其他板块跟随插件", () => {
  const { sectionLanguages } = decodePrefs({ sectionLanguages: { progress: "zh", context: "auto", servers: "fr", invalid: "en" } });
  assert.deepEqual(sectionLanguages, { progress: "zh" });
  const progress = effectiveSectionLanguage("en", sectionLanguages, "progress");
  assert.equal(progress, "zh");
  assert.equal(matchingProse(progress, "已经完成阶段验证"), "已经完成阶段验证");
  assert.equal(effectiveSectionLanguage("en", sectionLanguages, "context"), "en");
  assert.equal(effectiveSectionLanguage("zh", { environment: "en" }, "environment"), "en");
});

test("显示参数在边界中取整或回落默认，警戒线随设置变化", () => {
  assert.deepEqual(decodePrefs({ display: { warningPercent: 49, inlineLimit: 100, cardHeight: 1200.9 } }).display,
    { warningPercent: 50, inlineLimit: 20, cardHeight: 1200 });
  assert.deepEqual(decodePrefs({ display: { warningPercent: "60", inlineLimit: null, cardHeight: Number.NaN } }).display, DEFAULT_DISPLAY);
  assert.equal(displayValue("warningPercent", 96), 95);
  assert.equal(displayValue("inlineLimit", 3), 4);
  assert.equal(displayValue("cardHeight", 479), 480);
  assert.equal(meterTone(0.7, 0.65), "warning");
  assert.equal(meterTone(0.7, 0.85), "normal");
  assert.equal(meterTone(0.95, 0.95), "danger");
});
