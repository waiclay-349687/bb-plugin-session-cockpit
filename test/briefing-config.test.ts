import { test } from "node:test";
import assert from "node:assert/strict";
import { briefingConfigSchema, briefingUpdateSchema, briefingPatch } from "../lib/briefing-config.ts";

const fixture = {
  enabled: true, language: "auto", gatewayUrl: "http://localhost:3425", gatewayModel: "model-a, model-b",
  fallbackModel: "haiku", systemPrompt: "", defaultSystemPromptEn: "Summarize progress.",
  defaultSystemPromptZh: "总结进度。", dailyLimit: 300, todayCount: 12, resolvedLanguage: "en",
};

test("跨插件配置容忍额外字段和空自定义提示词，拒绝不兼容形状", () => {
  assert.deepEqual(briefingConfigSchema.parse({ ...fixture, systemPrompt: null, extra: "future" }), fixture);
  assert.equal(briefingConfigSchema.safeParse(null).success, false);
  assert.equal(briefingConfigSchema.safeParse({ ...fixture, resolvedLanguage: "auto" }).success, false);
  assert.equal(briefingConfigSchema.safeParse({ ...fixture, gatewayModel: [] }).success, false);
});

test("只提交修改字段；计数和冷却可以各自操作，非法表单值拒绝发送", () => {
  const config = briefingConfigSchema.parse(fixture);
  assert.deepEqual(briefingPatch(config, { gatewayUrl: config.gatewayUrl, language: "zh", dailyLimit: 200 }), { language: "zh", dailyLimit: 200 });
  assert.deepEqual(briefingUpdateSchema.parse({ resetTodayCount: true }), { resetTodayCount: true });
  assert.deepEqual(briefingUpdateSchema.parse({ clearCooldowns: true }), { clearCooldowns: true });
  assert.deepEqual(briefingUpdateSchema.parse({ systemPrompt: "" }), { systemPrompt: "" });
  for (const patch of [{ dailyLimit: 9 }, { dailyLimit: 2001 }, { dailyLimit: 20.5 }, { fallbackModel: "  " }, { typo: true }]) {
    assert.equal(briefingUpdateSchema.safeParse(patch).success, false);
  }
});
