import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONTEXT_LEVELS } from "../lib/context-files.ts";
import { categoryText, fileEntryText, languageMode, levelText, matchingProse, messages, resolveLanguage, textFor, PLUGIN_DESCRIPTION } from "../lib/i18n.ts";
import { formatAgo, formatCountdown, formatDuration, formatTokens, formatTtl } from "../lib/format.ts";

test("所有界面词条都有双语文案，各语言无残留界面词，插值参数一致", () => {
  const englishUi = /\b(?:context|usage|workspace|loaded|compact|messages|free space|servers|scripts|connectors|side chats|estimated|interface polish|choose details|confirm|cache|filter|close|workspace|terminal|running)\b/i;
  const englishHan = /[\u4e00-\u9fff]/;
  for (const [key, [en, zh]] of Object.entries(messages)) {
    assert.ok(en.trim() && zh.trim(), key);
    assert.doesNotMatch(en, englishHan, key);
    assert.doesNotMatch(zh, englishUi, key);
    const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    assert.deepEqual(params(en), params(zh), key);
  }
  assert.equal(textFor.en("runningCount", { count: 2 }), "2 running");
  assert.equal(textFor.zh("loaded", { count: "4/80" }), "已加载 4/80");
  assert.ok(PLUGIN_DESCRIPTION.length > 0);
});

test("明确语言优先；自动优先宿主语言，缺失时回落浏览器", () => {
  assert.equal(languageMode(undefined), "auto");
  assert.equal(languageMode("auto"), "auto");
  assert.equal(languageMode("fr"), "auto");
  assert.equal(languageMode("en"), "en");
  assert.equal(languageMode("zh"), "zh");
  assert.equal(resolveLanguage("en", "zh-CN", "zh-TW"), "en");
  assert.equal(resolveLanguage("zh", "en-US"), "zh");
  assert.equal(resolveLanguage("auto", "ZH-Hans", "en-US"), "zh");
  assert.equal(resolveLanguage("auto", "fr", "zh-CN"), "en");
  assert.equal(resolveLanguage("auto", "", "zh-TW"), "zh");
  assert.equal(resolveLanguage("auto"), "en");
});

test("覆盖官方分类、估算分类和子项，数据标签与文件名保持稳定", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/claude-code-context.json", import.meta.url), "utf8"));
  const official: string[] = fixture.usage.snapshot.categories.map((c: { label: string }) => c.label);
  const labels = [...official, "Context files", "System & tools (est.)", "Files read", "User messages", "Assistant messages", "Tool calls", "Tool results", "Attachments"];
  for (const label of labels) {
    assert.equal(categoryText(textFor.en, label), label.replace(/\s*\(deferred\)$/i, ""));
    assert.notEqual(categoryText(textFor.zh, label), "其他");
    assert.match(categoryText(textFor.zh, label), /\p{Script=Han}/u);
  }
  assert.equal(categoryText(textFor.zh, "Future category"), "其他");
  assert.deepEqual(CONTEXT_LEVELS.map(level => levelText(textFor.zh, level)), ["全局", "上级目录", "项目", "模块", "本地私有", "规则", "自动记忆"]);
  assert.deepEqual(CONTEXT_LEVELS.map(level => levelText(textFor.en, level)), ["Global", "Parent", "Project", "Modules", "Local", "Rules", "Memory"]);
  assert.equal(fileEntryText(textFor.zh, "Global · AGENTS.md"), "全局 · AGENTS.md");
  assert.equal(fileEntryText(textFor.en, "Global · AGENTS.md"), "Global · AGENTS.md");
  assert.equal(fileEntryText(textFor.zh, "apps/web/CLAUDE.md"), "apps/web/CLAUDE.md");
});

test("跨插件进度文本按语言显示；时间和紧凑单位跟随语言", () => {
  assert.equal(matchingProse("en", "等待验收"), undefined);
  assert.equal(matchingProse("zh", "Waiting for review"), undefined);
  assert.equal(matchingProse("zh", "等待验收"), "等待验收");
  assert.equal(matchingProse("en", "Waiting for review"), "Waiting for review");
  assert.equal(matchingProse("en", null), undefined);
  assert.equal(formatAgo(0, 300_000, "zh"), "5 分钟前");
  assert.equal(formatAgo(0, 500, "zh"), "刚刚");
  assert.equal(formatDuration(5_400_000, "zh"), "1 小时 30 分钟");
  assert.equal(formatCountdown(0, 100, "zh"), "现在");
  assert.equal(formatTtl(3_600_000, "zh"), "1 小时");
  assert.equal(formatTokens(12_000, "zh"), "1.2万");
  assert.equal(formatTokens(12_000, "en"), "12k");
});
