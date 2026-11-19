/**
 * [INPUT]: 依赖本地化会话文案及 依赖 data.ts (useSession/useNow)、lib/usage.ts 的 cacheState、cockpit.tsx
 * [OUTPUT]: 对外提供 SessionSegmentSummary / SessionSegmentDetails: 横幅模式 (手机与窄窗格) 下输入框上方的摘要按钮, 以及点开后在横幅下方展开的完整内容
 * [POS]: components/cockpit 的横幅入口; 手机上 bb 不显示线程上下文卡片, 这里是唯一入口;
 *        消费者: app.tsx 的 threadContextSegment (只在 banner 模式可见); 与卡片的边界: 内容同为 Cockpit, 只是容器不同
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useTranslation, useText } from "./language";
import type { ExperimentalThreadContextSegmentProps } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { useHostHeading } from "./host-styles";
import { textFor, type Language } from "../../lib/i18n";
import { formatCountdown } from "../../lib/format";
import type { SessionSnapshot } from "../../rpc";
import { cacheState } from "../../lib/usage";
import { Cockpit } from "./cockpit";
import { useNow, useSession } from "./data";

function cacheLabel(session: SessionSnapshot, now: number, language: Language): string | null {
  const state = cacheState({
    now,
    running: session.running,
    lastUsageAt: session.tokens.updatedAt,
    ttlMs: session.tokens.promptCacheTtlMs,
    compactionOfferAt: session.context?.compactionOfferAt ?? null,
  });
  if (state.kind === "warm") return textFor[language]("cacheWarm", { time: formatCountdown(state.expiresAt, now, language) });
  if (state.kind === "cold") return textFor[language]("cacheCold");
  return null;
}

/** 摘要即开关: 点击在横幅下方展开完整内容 (bb 的 segment 一次只展开一个) */
export function SessionSegmentSummary({ threadId, isExpanded, onToggle }: ExperimentalThreadContextSegmentProps) {
  const { t, language, formatTokens } = useTranslation();
  const heading = useHostHeading<HTMLButtonElement>("session", "banner");
  const session = useSession(threadId).data;
  const now = useNow(30_000);
  if (!session) return null;
  const cache = cacheLabel(session, now, language);
  const total = session.tokens.session?.total ?? null;
  return (
    <button
      type="button"
      ref={heading}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 truncate rounded px-1 text-xs hover:text-foreground active:scale-100 pointer-coarse:min-h-8",
        isExpanded ? "text-foreground" : "text-muted-foreground",
      )}
      onClick={onToggle}
      aria-expanded={isExpanded}
      aria-label={t("sessionDetails")}
    >
      <Icon name="Limitation" fallback="ChartColumn" className="size-3.5 shrink-0" aria-hidden />
      {cache ? <span className="tabular-nums">{cache}</span> : null}
      {cache && total !== null ? <span aria-hidden>·</span> : null}
      {total !== null ? <span className="tabular-nums">{t("tokens", { count: formatTokens(total) })}</span> : null}
      {!cache && total === null ? <span>{t("session")}</span> : null}
      <Icon name="ChevronDown" className={cn("size-3 shrink-0 transition-transform duration-150", isExpanded && "rotate-180")} aria-hidden />
    </button>
  );
}

/** 展开后的内容: 限高并内部滚动, 不把对话挤出屏幕 */
export function SessionSegmentDetails({ threadId, projectId, isExpanded }: ExperimentalThreadContextSegmentProps) {
  if (!isExpanded) return null;
  return (
    <div className="max-h-[50dvh] overflow-y-auto overscroll-contain px-1 py-1">
      <Cockpit threadId={threadId} projectId={projectId} />
    </div>
  );
}
