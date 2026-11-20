/**
 * [INPUT]: Worktree Lineage 的速览配置与更新请求。
 * [OUTPUT]: 配置响应、部分更新和编辑字段的运行时契约；progressLanguagePatch（Progress 板块改语言时同步给速览生成语言的补丁）。
 * [POS]: 可单测的跨插件边界；设置页以目标插件作为配置的唯一来源。
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { z } from "zod";
import { LANGUAGE_MODES } from "./i18n.ts";

const language = z.enum(LANGUAGE_MODES);
const count = z.number().int().nonnegative();
const editable = z.object({
  enabled: z.boolean(),
  language,
  gatewayUrl: z.string(),
  gatewayModel: z.string(),
  fallbackModel: z.string(),
  systemPrompt: z.string(),
  dailyLimit: count,
});

export const briefingConfigSchema = editable.extend({
  systemPrompt: z.string().nullable().transform(value => value ?? ""),
  defaultSystemPromptEn: z.string(),
  defaultSystemPromptZh: z.string(),
  todayCount: count,
  resolvedLanguage: z.enum(["en", "zh"]),
});

export const BRIEFING_LIMIT = { min: 10, max: 2000 } as const;
export const BRIEFING_PROMPT_MAX = 8000;
export const BRIEFING_GATEWAY_MAX = 2000;
export const BRIEFING_FALLBACK_MAX = 200;

export const briefingUpdateSchema = editable.extend({
  gatewayUrl: z.string().max(BRIEFING_GATEWAY_MAX),
  gatewayModel: z.string().max(BRIEFING_GATEWAY_MAX),
  fallbackModel: z.string().trim().min(1).max(BRIEFING_FALLBACK_MAX),
  systemPrompt: z.string().max(BRIEFING_PROMPT_MAX),
  dailyLimit: count.min(BRIEFING_LIMIT.min).max(BRIEFING_LIMIT.max),
}).partial().extend({
  resetTodayCount: z.boolean().optional(),
  clearCooldowns: z.boolean().optional(),
}).strict();

export type BriefingConfig = z.output<typeof briefingConfigSchema>;
export type BriefingEdit = z.infer<typeof editable>;
export type BriefingUpdate = z.infer<typeof briefingUpdateSchema>;

export function briefingPatch(current: BriefingConfig, draft: Partial<BriefingEdit>): Partial<BriefingEdit> {
  return Object.fromEntries(Object.entries(draft).filter(([key, value]) => value !== current[key as keyof BriefingEdit]));
}

/**
 * 设置页改板块语言时要不要同步速览生成语言：只有 Progress 板块要（它显示的就是那份速览），
 * 选“跟随插件”同步为 auto，选中文 / 英文同步为对应语言；其他板块返回 null。
 */
export function progressLanguagePatch(sectionId: string, mode: "auto" | "en" | "zh"): { language: "auto" | "en" | "zh" } | null {
  return sectionId === "progress" ? { language: mode } : null;
}
