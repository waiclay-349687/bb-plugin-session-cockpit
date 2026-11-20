/**
 * [INPUT]: 依赖本地化用量、缓存和时间格式及 依赖 data.ts 的 useSession/useNow、lib/usage.ts 的 cacheState/hitRate、context-section.tsx 的 CompactButton (两步确认压缩)
 * [OUTPUT]: 对外提供 UsageSection: Usage 分区 (一行摘要 → 展开为 Prompt 缓存、工作时长、成本与 Token 明细)
 * [POS]: 对应 Ghostex 会话详情的 Limits 标签, 压成卡片里的几行; 消费者: cockpit.tsx; 与 context-section.tsx 的边界: 本分区讲"本会话花了多少、缓存热不热"; 账号级的计划额度只在 usage-rings 插件 (侧边栏圆环) 里显示, 这里不重复
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useTranslation, useText } from "./language";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { textFor, type Language } from "../../lib/i18n";
import { formatCountdown as countdown } from "../../lib/format";
import type { SessionSnapshot } from "../../rpc";
import { formatPercent } from "../../lib/format";
import { cacheState, hitRate } from "../../lib/usage";
import { useNow, useSession } from "./data";
import type { SectionProps } from "./cockpit";
import { CHEVRON_MOTION, CardRow, Collapse, Dot, Hint, SectionBody, SectionRow, toneVar } from "./rows";
import { CompactButton } from "./context-section";

/** 剩余不足这个时长且上下文够大时, 提示先压缩 (Ghostex 的空闲压缩思路) */
const EXPIRY_HINT_MS = 10 * 60_000;
const LARGE_CONTEXT = 100_000;

export function UsageSection({ threadId, open, onToggle }: SectionProps) {
  const { t, language, formatTokens, formatCost } = useTranslation();
  const session = useSession(threadId).data;
  const now = useNow(15_000);
  if (!session) return null;

  // 摘要: 本会话 token 总量 + 缓存状态 (账号级计划额度在侧边栏圆环里, 不重复显示)
  const total = session.tokens.session?.total ?? null;
  const cache = cacheText(session, now, language);
  return (
    <div>
      <SectionRow
        icon="ChartColumn"
        label={t("sessionDetail")}
        open={open}
        onToggle={onToggle}
        summary={
          <>
            {total !== null ? <span>{t("tokens", { count: formatTokens(total) })}</span> : null}
            {total !== null && cache ? <span>·</span> : null}
            {cache ? <span>{cache}</span> : null}
          </>
        }
      />
      <SectionBody open={open}>
        <CacheRow session={session} now={now} />
        <TimeRow session={session} now={now} />
        {session.context?.cost ? <CardRow stat label={t("cost")} trailing={formatCost(session.context.cost)} /> : null}
        {session.tokens.session ? <TokenDetails session={session} /> : null}
      </SectionBody>
    </div>
  );
}

/** 摘要里的缓存短语: "cache 42m" / t("cacheCold") */
function cacheText(session: SessionSnapshot, now: number, language: Language): string | null {
  const t = textFor[language];
  const state = cacheState({
    now,
    running: session.running,
    lastUsageAt: session.tokens.updatedAt,
    ttlMs: session.tokens.promptCacheTtlMs,
    compactionOfferAt: session.context?.compactionOfferAt ?? null,
  });
  if (state.kind === "warm") return t("cacheWarm", { time: countdown(state.expiresAt, now, language) });
  if (state.kind === "cold") return t("cacheCold");
  return null;
}

function CacheRow({ session, now }: { session: SessionSnapshot; now: number }) {
  const { t, formatCountdown, formatTtl, formatTokens } = useTranslation();
  const state = cacheState({
    now,
    running: session.running,
    lastUsageAt: session.tokens.updatedAt,
    ttlMs: session.tokens.promptCacheTtlMs,
    compactionOfferAt: session.context?.compactionOfferAt ?? null,
  });
  const used = session.context?.usedTokens ?? null;
  const view =
    state.kind === "in-use"
      ? { dot: "var(--success)", text: t("inUse") }
      : state.kind === "warm"
        ? { dot: "var(--success)", text: t("cacheWarm", { time: formatCountdown(state.expiresAt, now) }) }
        : state.kind === "cold"
          ? { dot: "var(--muted-foreground)", text: t("cacheCold") }
          : { dot: "var(--muted-foreground)", text: state.reason === "no-ttl" ? t("notReported") : "—" };
  const ttl = session.tokens.promptCacheTtlMs;
  return (
    <>
      <CardRow
        stat
        label={t("promptCache")}
        title={ttl !== null ? t("cacheLifetime", { time: formatTtl(ttl) }) : undefined}
        trailing={
          <>
            <Dot color={view.dot} />
            <span>{view.text}</span>
          </>
        }
      />
      {state.kind === "cold" && used !== null && used >= 20_000 ? (
        <Hint tone="warning">{t("cacheReread", { count: formatTokens(used) })}</Hint>
      ) : null}
      {state.kind === "warm" && state.remainingMs < EXPIRY_HINT_MS && used !== null && used >= LARGE_CONTEXT ? (
        <ExpiryHint threadId={session.threadId} used={used} />
      ) : null}
    </>
  );
}

/** 缓存将过期的提示; 压缩不可撤销, 与 Context 分区同一个两步确认按钮 */
function ExpiryHint({ threadId, used }: { threadId: string; used: number }) {
  const { t, formatTokens } = useTranslation();
  return (
    <div className="flex items-start gap-2 px-2 pb-1">
      <p className="min-w-0 flex-1 text-[11px] leading-4" style={{ color: toneVar("warning") }}>
        {t("cacheExpiry", { count: formatTokens(used) })}
      </p>
      <CompactButton threadId={threadId} disabled={false} />
    </div>
  );
}

function TimeRow({ session, now }: { session: SessionSnapshot; now: number }) {
  const { t, formatDuration } = useTranslation();
  const live = session.running && session.turns.activeSince !== null ? Math.max(0, now - session.turns.activeSince) : 0;
  const turns = session.turns.completed + (session.running ? 1 : 0);
  const turnsText = t(turns === 1 ? "turn" : "turns", { count: turns });
  return (
    <CardRow
      stat
      label={t("agentWorking")}
      title={t("sessionOpen", { time: formatDuration(now - session.createdAt), turns: turnsText })}
      trailing={
        <>
          <span>{formatDuration(session.turns.workingMs + live)}</span>
          <span className="text-muted-foreground">· {turnsText}</span>
        </>
      }
    />
  );
}

/** Token 明细默认收成一行 (总量 + 缓存命中率), 点开才列出五项: 平时不需要逐项看 */
function TokenDetails({ session }: { session: SessionSnapshot }) {
  const { t, formatTokens } = useTranslation();
  const [open, setOpen] = useState(false);
  const total = session.tokens.session!;
  const last = session.tokens.lastTurn;
  const line = (label: string, value: string, hint?: string) => (
    <div key={label} className="flex h-5 items-center gap-2 px-2 text-[11px] text-muted-foreground" title={hint}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 tabular-nums text-foreground/80">{value}</span>
    </div>
  );
  return (
    <>
      <CardRow
        stat
        label={t("tokenDetails")}
        expanded={open}
        onClick={() => setOpen(!open)}
        title={t("cacheRateHelp")}
        trailing={
          <>
            <span>{formatTokens(total.total)}</span>
            <span className="text-muted-foreground">· {t("cached", { percent: formatPercent(hitRate(total)) })}</span>
            <Icon name="ChevronRight" className={cn("size-3 text-muted-foreground", CHEVRON_MOTION, open && "rotate-90")} aria-hidden />
          </>
        }
      />
      <Collapse open={open}>
        <div className="pb-0.5">
          {line(t("cacheReadWrite"), `${formatTokens(total.cacheRead)} · ${formatTokens(total.cacheWrite)}`)}
          {line(t("output"), formatTokens(total.output))}
          {last ? line(t("lastTurn"), `${formatTokens(last.uncachedInput + last.cacheRead + last.cacheWrite)} · ${formatTokens(last.output)}`, t("lastTurnHelp")) : null}
        </div>
      </Collapse>
    </>
  );
}
