/**
 * [INPUT]: 依赖双语状态与 依赖 @get-bb/plugin-sdk/app 的 experimental_useRpcQuery 跨插件读取 worktree-lineage 插件的 briefing RPC (存盘的"全程速览" + 是否落后 + 兜底摘要); 依赖 data.ts 的 useSession (本轮是否在跑、已完成几轮, 用来决定何时重读)
 * [OUTPUT]: 对外提供 ProgressSection: Progress 组里唯一的一项。收起时一行 = 当前阶段 + 完成数 (如 "● 右上角 Session 插件  3/5"); 点开 = 一句话概括 + 完整的阶段轨道 (每个阶段带结论)
 * [POS]: components/cockpit 的"这条对话到哪了"分区; 消费者: cockpit.tsx; 与 worktree-lineage 的边界: 速览由那个插件在每轮结束时让小模型写好并存盘, 这里只读、从不触发生成, 所以多显示一处不多花一分额度;
 *        那个插件没装、被停用或返回的形状对不上时, 本分区不显示
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useTranslation, useText } from "./language";
import { matchingProse } from "../../lib/i18n";
import { useEffect, useRef } from "react";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
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
  return query.data;
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
  const view = useBriefing(threadId);
  // 插件没装 / 用户关了速览 / 还一轮都没聊: 没有可显示的东西 (整组连组名一起不出现)
  if (!view || !view.enabled || (view.briefing === null && view.recap.turns === 0)) return null;
  const { briefing } = view;
  // 速览还没写出来 (第一轮还在跑): 一行说明, 没有可点开的内容
  if (briefing === null) {
    return (
      <div data-cockpit-item="" className="flex h-6.5 items-center gap-2 px-2 text-xs text-muted-foreground pointer-coarse:h-9">
        <Icon name="ListTodo" fallback="Circle" className="size-3.5 shrink-0" aria-hidden />
        <span>{t("writtenWhenDone")}</span>
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
        {behind ? <p className="px-2 pt-2 text-[11px] leading-4 text-muted-foreground">{t("updatesWhenDone")}</p> : null}
      </SectionBody>
    </div>
  );
}
