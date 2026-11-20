import { test } from "node:test";
import assert from "node:assert/strict";
import { canRegenerate, regenerateNotice, regenerateResultSchema } from "../lib/briefing-regenerate.ts";
import { textFor } from "../lib/i18n.ts";

test("重新生成结果：只抄用到的字段，容忍额外字段；不认识的状态按失败处理", () => {
  assert.deepEqual(regenerateResultSchema.parse({ ok: true, status: "written", briefing: { about: "x" }, extra: 1 }), { ok: true, status: "written" });
  assert.deepEqual(regenerateResultSchema.parse({ ok: false, status: "brand-new-status" }), { ok: false, status: "failed" });
  assert.equal(regenerateResultSchema.safeParse({ status: "written" }).success, false);
  assert.equal(regenerateResultSchema.safeParse(null).success, false);
});

test("何时给“重新生成”：开关开着，并且有速览或至少聊过一轮", () => {
  assert.equal(canRegenerate({ enabled: true, briefing: { about: "x" }, recap: { turns: 0 } }), true);
  assert.equal(canRegenerate({ enabled: true, briefing: null, recap: { turns: 2 } }), true);
  assert.equal(canRegenerate({ enabled: true, briefing: null, recap: { turns: 0 } }), false);
  assert.equal(canRegenerate({ enabled: false, briefing: { about: "x" }, recap: { turns: 3 } }), false);
  assert.equal(canRegenerate(undefined), false);
});

test("结果 → 轻提示：成功、各种失败原因、对方插件不可用，两种语言都有文案", () => {
  const cases = [
    [{ ok: true, status: "written" }, "success", "regenerated"],
    [{ ok: false, status: "disabled" }, "error", "regenDisabled"],
    [{ ok: false, status: "empty" }, "error", "regenEmpty"],
    [{ ok: false, status: "unavailable" }, "error", "regenUnavailable"],
    [{ ok: false, status: "limit" }, "error", "regenLimit"],
    [{ ok: false, status: "failed" }, "error", "regenFailed"],
    [null, "error", "regenUnreachable"],
  ] as const;
  for (const [result, kind, key] of cases) {
    assert.deepEqual(regenerateNotice(result), { kind, key });
    assert.doesNotMatch(textFor.en(key), /[一-鿿]/, key);
    assert.doesNotMatch(textFor.zh(key), /[A-Za-z]/, key);
  }
  assert.equal(textFor.zh("regenerate"), "重新生成");
  assert.equal(textFor.en("regenerate"), "Regenerate");
});
