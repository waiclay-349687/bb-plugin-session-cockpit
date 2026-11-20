/**
 * [INPUT]: Worktree Lineage 的 regenerateBriefing 结果。
 * [OUTPUT]: regenerateResultSchema（只抄用到的字段，容忍额外字段与将来的新状态）、canRegenerate（Progress 何时给“重新生成”按钮）、regenerateNotice（结果 → 通知种类与词条键）。
 * [POS]: 可单测的跨插件边界；按钮在 components/cockpit/progress-section.tsx，提示文案按 Progress 板块的有效语言从 lib/i18n 取。
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { z } from "zod";
import type { MessageKey } from "./i18n.ts";

/** 对方的 status 可能增加：不认识的一律按失败处理，不让解析失败把按钮弄坏 */
const KNOWN = ["written", "disabled", "empty", "unavailable", "limit", "failed", "skipped"] as const;
export type RegenerateStatus = (typeof KNOWN)[number];

export const regenerateResultSchema = z.object({
  ok: z.boolean(),
  status: z.string().transform((value): RegenerateStatus => ((KNOWN as readonly string[]).includes(value) ? (value as RegenerateStatus) : "failed")),
});
export type RegenerateResult = z.output<typeof regenerateResultSchema>;

/** 有速览、或者已经聊过至少一轮，并且速览开关开着，才给“重新生成” */
export function canRegenerate(view: { enabled: boolean; briefing: unknown | null; recap: { turns: number } } | null | undefined): boolean {
  return Boolean(view && view.enabled && (view.briefing !== null || view.recap.turns > 0));
}

const FAILURE: Record<Exclude<RegenerateStatus, "written" | "skipped">, MessageKey> = {
  disabled: "regenDisabled",
  empty: "regenEmpty",
  unavailable: "regenUnavailable",
  limit: "regenLimit",
  failed: "regenFailed",
};

/** 结果 → 轻提示；调用本身失败（对方插件没装、被停用或接口不兼容）用 null 表示 */
export function regenerateNotice(result: RegenerateResult | null): { kind: "success" | "error"; key: MessageKey } {
  if (!result) return { kind: "error", key: "regenUnreachable" };
  if (result.ok || result.status === "written" || result.status === "skipped") return { kind: "success", key: "regenerated" };
  return { kind: "error", key: FAILURE[result.status] };
}
