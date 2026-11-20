import { test } from "node:test";
import assert from "node:assert/strict";
import { briefingDisplay } from "../lib/progress-view.ts";
import { progressLanguagePatch } from "../lib/briefing-config.ts";
import { textFor } from "../lib/i18n.ts";

const fallback = (lang: "en" | "zh") => ({ about: textFor[lang]("progressFallback"), stage: (count: number) => textFor[lang]("progressStage", { count }) });

const zhBriefing = {
  about: "把进展速览改走本机 Magpie 网关",
  stages: [
    { title: "梳理回退规则", state: "done" as const, note: "网关失败再用本机 Haiku" },
    { title: "实现模型链", state: "doing" as const, note: "还剩冷却与日志" },
  ],
};
const enBriefing = {
  about: "Route progress summaries through the local Magpie gateway",
  stages: [{ title: "Define fallback rules", state: "done" as const, note: "Fall back to local Haiku when the gateway fails" }],
};

test("异语种速览完整显示原文：英文板块显示中文速览、中文板块显示英文速览，概括、标题、细则都不换成占位字", () => {
  for (const lang of ["en", "zh"] as const) {
    const zh = briefingDisplay(zhBriefing, fallback(lang));
    assert.equal(zh.about, zhBriefing.about);
    assert.deepEqual(zh.stages.map((s) => [s.title, s.note]), [["梳理回退规则", "网关失败再用本机 Haiku"], ["实现模型链", "还剩冷却与日志"]]);
    const en = briefingDisplay(enBriefing, fallback(lang));
    assert.equal(en.about, enBriefing.about);
    assert.deepEqual(en.stages.map((s) => [s.title, s.note]), [["Define fallback rules", "Fall back to local Haiku when the gateway fails"]]);
    for (const shown of [zh, en]) {
      assert.ok(!shown.stages.some((s) => /第 \d+ 阶段|Stage \d+/.test(s.title)));
    }
  }
});

test("中英混写的速览（以前会被屏蔽）也原样显示", () => {
  const mixed = { about: "切换 Progress model routing 到 Magpie gateway", stages: [{ title: "Switch Progress model routing", state: "doing" as const, note: "Wants Magpie DeepSeek first, 本机 Haiku 兜底" }] };
  const shown = briefingDisplay(mixed, fallback("zh"));
  assert.equal(shown.about, mixed.about);
  assert.equal(shown.stages[0]!.title, "Switch Progress model routing");
  assert.equal(shown.stages[0]!.note, "Wants Magpie DeepSeek first, 本机 Haiku 兜底");
});

test("只有字段本身为空才用占位字；收起时显示进行中的阶段与完成数", () => {
  const shown = briefingDisplay({ about: " ", stages: [{ title: "", state: "done", note: "" }, { title: "实现模型链", state: "doing", note: "x" }, { title: "旧方案", state: "dropped", note: "" }] }, fallback("zh"));
  assert.equal(shown.about, textFor.zh("progressFallback"));
  assert.equal(shown.stages[0]!.title, textFor.zh("progressStage", { count: 1 }));
  assert.equal(shown.stages[0]!.note, null);
  assert.deepEqual(shown.headline, { title: "实现模型链", state: "doing" });
  assert.deepEqual([shown.done, shown.total], [1, 2]);
  assert.deepEqual(briefingDisplay({ about: "a", stages: [{ title: "全做完", state: "done", note: "" }] }, fallback("en")).headline, { title: "全做完", state: "done" });
});

test("Progress 改语言自动同步速览生成语言：只有 Progress 板块同步，跟随插件同步为 auto", () => {
  assert.deepEqual(progressLanguagePatch("progress", "zh"), { language: "zh" });
  assert.deepEqual(progressLanguagePatch("progress", "en"), { language: "en" });
  assert.deepEqual(progressLanguagePatch("progress", "auto"), { language: "auto" });
  assert.equal(progressLanguagePatch("context", "zh"), null);
  assert.equal(progressLanguagePatch("usage", "en"), null);
});
