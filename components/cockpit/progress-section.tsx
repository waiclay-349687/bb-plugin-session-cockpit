/**
 * [INPUT]: 依赖板块有效语言（含 useSectionNotice 轻提示）、lib/briefing-regenerate 的结果契约与提示映射和 @get-bb/plugin-sdk/app 的 experimental_useRpcQuery 跨插件读取 worktree-lineage 插件的 briefing RPC (存盘的"全程速览" + 是否落后 + 兜底摘要); 依赖 data.ts 的 useSession (本轮是否在跑、已完成几轮, 用来决定何时重读)
 * [OUTPUT]: 对外提供 ProgressSection: Progress 组里唯一的一项（展开后的底栏有“重新生成”按钮，调用 worktree-lineage 的 regenerateBriefing）。收起时一行 = 当前阶段 + 完成数 (如 "● 右上角 Session 插件  3/5"); 点开 = 一句话概括 + 完整的阶段轨道 (每个阶段带结论)
 * [POS]: components/cockpit 的"这条对话到哪了"分区; 消费者: cockpit.tsx; 与 worktree-lineage 的边界: 速览由那个插件在每轮结束时让小模型写好并存盘, 本分区平时只读已保存内容; 只有用户点“重新生成”才请对方立即重写一次 (花一次额度, 受对方每天上限约束);
 *        那个插件没装、被停用或返回的形状对不上时, 本分区不显示
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useSectionNotice, useTranslation, useText } from "./language";
import { matchingProse } from "../../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_useRpcMutation, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { canRegenerate, regenerateNotice, regenerateResultSchema } from "../../lib/briefing-regenerate";
import { z } from "zod";
import { Icon } from "@/components/ui/icon";
import { useSession } from "./data";
import type { SectionProps } from "./cockpit";
import { SectionBody, SectionRow } from "./rows";

/** 写速览的插件; 它的 briefing RPC 是只读的, 别的插件可以按 id 调用 */
const BRIEFING_PLUGIN_ID = "worktree-lineage";

/** 只抄本分区读的字段 (其余字段 zod 会丢弃); 对方改了形状这里就解析失败, 分区自动隐藏 */
const stageSchema = z.object({ title: z.string(), state: z.enum(["done", "doing", "dropped"]), note: z.string() });
const briefingContract = defineRpcContract({
  briefing: {
    input: z.object({ threadId: z.string() }),
    output: z.object({
      briefing: z
        .object({
          about: z.string(),
          stages: z.array(stageSchema),
          now: z.string(),
          waiting: z.string().nullable(),
          next: z.string().nullable(),
        })
        .nullable(),
      freshness: z
        .discriminatedUnion("state", [z.object({ state: z.literal("fresh") }), z.object({ state: z.literal("behind"), newAsks: z.number() })])
        .nullable(),
      recap: z.object({ turns: z.number(), ask: z.string().nullable(), reply: z.string().nullable() }),
      enabled: z.boolean(),
    }),
  },
  /** 手动重新生成一条对话的速览：对方立即按当前配置重写，status 说明结果 */
  regenerateBriefing: {
    input: z.object({ threadId: z.string() }),
    output: regenerateResultSchema,
  },
});
type Stage = z.infer<typeof stageSchema>;

/** 一轮结束后, 那边要 4-15 秒才写完新速览: 结束时读一次 (先拿到"落后"的结论), 之后再补读几次 */
const REFETCH_AFTER_IDLE_MS = [6_000, 15_000, 30_000];

function useBriefing(threadId: string) {
  const query = experimental_useRpcQuery({ pluginId: BRIEFING_PLUGIN_ID, contract: briefingContract, method: "briefing", input: { threadId } });
  const session = useSession(threadId).data;
  const running = session?.running ?? false;
  const completed = session?.turns.completed ?? 0;
  // SDK 的 refetch 每次渲染都是新函数, 不能进 effect 依赖
  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void refetchRef.current();
    if (running) return;
    const timers = REFETCH_AFTER_IDLE_MS.map((delay) => setTimeout(() => void refetchRef.current(), delay));
    return () => timers.forEach(clearTimeout);
  }, [running, completed]);
  return { view: query.data, refetch: () => refetchRef.current() };
}

/**
 * 重新生成：调用对方的 regenerateBriefing，生成中禁用并显示省略号防连点；完成后重读速览，
 * 轻提示按 Progress 板块的有效语言说明结果（成功、开关关着、没有内容、额度用完、模型都失败、插件不可用）。样式与 Compact 一致。
 */
function RegenerateButton({ threadId, onDone }: { threadId: string; onDone: () => Promise<unknown> }) {
  const t = useText();
  const notify = useSectionNotice();
  const mutation = experimental_useRpcMutation({ pluginId: BRIEFING_PLUGIN_ID, contract: briefingContract, method: "regenerateBriefing" });
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const result = await mutation.mutate({ threadId }).catch(() => null);
      const notice = regenerateNotice(result);
      if (result?.ok) await onDone().catch(() => undefined);
      notify(notice.kind, notice.key);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className="h-5 min-w-[4.5rem] shrink-0 rounded border border-border px-1.5 text-center text-[11px] text-foreground hover:bg-state-hover disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-8"
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={() => void run()}
      aria-label={t(busy ? "regenerating" : "regenerateProgress")}
      title={t(busy ? "regenerating" : "regenerateProgress")}
    >
      {busy ? "…" : t("regenerate")}
    </button>
  );
}


/** 阶段标记: 完成是绿底对勾, 进行中是实心点, 放弃是灰底短横; 颜色只用主题变量 */
function StageMark({ state }: { state: Stage["state"] }) {
  const t = useText();
  const tint = state === "done" ? "var(--success)" : state === "doing" ? "var(--primary)" : "var(--muted-foreground)";
  return (
    <span
      className="flex size-3.5 shrink-0 items-center justify-center rounded-full"
      style={{ background: `color-mix(in oklab, ${tint} ${state === "dropped" ? 14 : 18}%, transparent)`, color: tint }}
      role="img"
      aria-label={t(state)}
    >
      {state === "done" ? (
        <Icon name="Check" className="size-2.5" aria-hidden />
      ) : state === "doing" ? (
        <span className="size-1.5 rounded-full" style={{ background: tint }} />
      ) : (
        <span className="h-px w-1.5 rounded-full" style={{ background: tint }} />
      )}
    </span>
  );
}

/** 点开后的完整轨道: 每个阶段一行名称 + 它的结论, 标记之间用细线连起来 */
function Stages({ stages }: { stages: readonly Stage[] }) {
  const { t, language } = useTranslation();
  return (
    <ol className="px-2 pt-2">
      {stages.map((stage, index) => (
        <li key={index} className="relative flex gap-2 pb-2 last:pb-0">
          {index < stages.length - 1 ? <span className="absolute bottom-0 left-[6.5px] top-[18px] w-px bg-border" aria-hidden /> : null}
          <span className="mt-px">
            <StageMark state={stage.state} />
          </span>
          <div className="min-w-0 flex-1">
            <div className={stage.state === "dropped" ? "text-xs leading-4 text-muted-foreground" : "text-xs font-medium leading-4 text-foreground"}>{matchingProse(language, stage.title) ?? t("progressStage", { count: index + 1 })}</div>
            {matchingProse(language, stage.note) ? <div className="text-[11px] leading-4 text-muted-foreground">{stage.note}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** 收起时显示哪个阶段: 进行中的那个; 没有进行中的 (全做完了) 就显示最后一个没放弃的 */
function headline(stages: readonly Stage[]): Stage | undefined {
  return stages.find((stage) => stage.state === "doing") ?? [...stages].reverse().find((stage) => stage.state !== "dropped") ?? stages[stages.length - 1];
}

export function ProgressSection({ threadId, open, onToggle }: SectionProps) {
  const { t, language } = useTranslation();
  const { view, refetch } = useBriefing(threadId);
  // 插件没装 / 用户关了速览 / 还一轮都没聊: 没有可显示的东西 (整组连组名一起不出现)
  if (!view || !view.enabled || (view.briefing === null && view.recap.turns === 0)) return null;
  const { briefing } = view;
  // 速览还没写出来 (第一轮还在跑): 一行说明, 没有可点开的内容
  if (briefing === null) {
    return (
      <div data-cockpit-item="" className="flex h-6.5 items-center gap-2 px-2 text-xs text-muted-foreground pointer-coarse:h-9">
        <Icon name="ListTodo" fallback="Circle" className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{t("writtenWhenDone")}</span>
        {canRegenerate(view) ? <RegenerateButton threadId={threadId} onDone={refetch} /> : null}
      </div>
    );
  }
  const behind = view.freshness?.state === "behind";
  const current = headline(briefing.stages);
  const done = briefing.stages.filter((stage) => stage.state === "done").length;
  const total = briefing.stages.filter((stage) => stage.state !== "dropped").length;
  return (
    <div>
      <SectionRow
        leading={current ? <StageMark state={current.state} /> : undefined}
        label={current ? matchingProse(language, current.title) ?? t("progressStage", { count: briefing.stages.indexOf(current) + 1 }) : t("progressFallback")}
        title={matchingProse(language, briefing.about)}
        priority="label"
        open={open}
        onToggle={onToggle}
        summary={
          <span>
            {done}/{total}
          </span>
        }
      />
      <SectionBody open={open}>
        <p className="px-2 pt-0.5 text-xs leading-4 text-foreground">{matchingProse(language, briefing.about) ?? t("progressFallback")}</p>
        <Stages stages={briefing.stages} />
        {/* 底栏：左边是“落后时会在这一轮结束后更新”的说明，右边是重新生成（与 Context 底栏的 Compact 同样式） */}
        <div className="flex items-center gap-2 px-2 pt-2">
          <span className="min-w-0 flex-1 truncate text-[11px] leading-4 text-muted-foreground">{behind ? t("updatesWhenDone") : ""}</span>
          {canRegenerate(view) ? <RegenerateButton threadId={threadId} onDone={refetch} /> : null}
        </div>
      </SectionBody>
    </div>
  );
}
