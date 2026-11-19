/**
 * [INPUT]: 依赖 data.ts 的 useSession/useNow、lib/usage.ts 的标签与工具名推断、lib/palette.ts 配色、宿主 FileLink 与 threads.compact、脚手架 Dialog
 * [OUTPUT]: 对外提供 ContextSection: 官方快照与标明来源的估算分类共用 Context 分区的渐进展示 (一行摘要 → 就地展开分类明细 → 分类再就地展开前 8 个条目 → 更多时弹层搜索); CompactButton: 两步确认的压缩按钮 (usage-section 复用)
 * [POS]: 对应 Claude Desktop 的 Context 面板; 消费者: cockpit.tsx; 与 usage-section.tsx 的边界: 本分区只讲"窗口里装了什么", 消耗、额度与缓存在 Usage 分区
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useMemo, useState } from "react";
import { experimental_FileLink as FileLink, useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { SessionCategory, SessionContext, SessionSnapshot } from "../../rpc";
import { formatAgo, formatPercent, formatTokens } from "../../lib/format";
import { categoryColor, meterTone } from "../../lib/palette";
import { displayCategoryLabel, toolName } from "../../lib/usage";
import type { SectionProps } from "./cockpit";
import { useNow, useSession } from "./data";
import { Collapse, Hint, SectionBody, SectionRow, toneVar } from "./rows";

export function ContextSection({ threadId, open, onToggle }: SectionProps) {
  const session = useSession(threadId).data;
  const ctx = session?.context;
  if (!session || !ctx || ctx.windowTokens <= 0) return null;
  const ratio = ctx.usedTokens / ctx.windowTokens;
  const tone = meterTone(ratio);
  return (
    <div>
      <SectionRow
        icon="Limitation"
        label="Context"
        open={open}
        onToggle={onToggle}
        summary={
          <>
            <span style={tone === "normal" ? undefined : { color: toneVar(tone) }}>{formatPercent(ratio, 0)}</span>
            <span>
              · {ctx.estimated ? "≈" : ""}
              {formatTokens(ctx.usedTokens)}/{formatTokens(ctx.windowTokens)}
            </span>
          </>
        }
      />
      <SectionBody open={open}>
        <Body session={session} ctx={ctx} />
      </SectionBody>
    </div>
  );
}

function Body({ session, ctx }: { session: SessionSnapshot; ctx: SessionContext }) {
  const now = useNow(30_000);
  // 就地展开的分类, 可同时展开多个; 条目很多时再用弹层看全部
  const [expanded, setExpanded] = useState<string[]>([]);
  const [detail, setDetail] = useState<SessionCategory | null>(null);
  const used = ctx.categories.filter((c) => c.kind === "used");
  const tail = ctx.categories.filter((c) => c.kind === "reserved" || c.kind === "free");
  const deferred = ctx.categories.filter((c) => c.kind === "deferred");
  const row = (category: SessionCategory, index: number) => (
    <CategoryRow
      key={category.id}
      category={category}
      color={categoryColor(category.label, category.kind, index)}
      windowTokens={ctx.windowTokens}
      hostId={session.hostId}
      open={expanded.includes(category.id)}
      onToggle={() => setExpanded(expanded.includes(category.id) ? expanded.filter((id) => id !== category.id) : [...expanded, category.id])}
      onShowAll={() => setDetail(category)}
    />
  );
  return (
    <div className="pb-1">
      <div className="px-2 pb-1 pt-0.5">
        <ContextBar ctx={ctx} />
      </div>
      {ctx.usedTokens / ctx.windowTokens >= 0.8 ? (
        <Hint tone="warning">
          {formatPercent(1 - ctx.usedTokens / ctx.windowTokens, 0)} left. Compact, or continue in a new thread before the window fills.
        </Hint>
      ) : null}
      {ctx.categories.length === 0 ? (
        <Hint>{session.running ? "The breakdown arrives when this turn ends." : "This provider reports the total only."}</Hint>
      ) : (
        <>
          {used.map(row)}
          {tail.length > 0 ? <div className="mx-2 my-1 border-t border-border" /> : null}
          {tail.map(row)}
          {deferred.length > 0 ? (
            <>
              <p className="px-2 pb-0.5 pt-1.5 text-[11px] leading-4 text-muted-foreground" title="Loaded when needed. Excluded from current usage.">
                Available on demand
              </p>
              {deferred.map(row)}
            </>
          ) : null}
        </>
      )}
      <div className="flex items-center gap-2 px-2 pt-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] leading-4 text-muted-foreground">
          {ctx.breakdownEstimated ? <span title="Estimated from recent BB events and likely instruction files. The remainder includes system, tools and unobserved content.">Estimated breakdown</span> : ctx.capturedAt !== null ? `Breakdown from ${formatAgo(ctx.capturedAt, now)}` : (ctx.model ?? "")}
        </span>
        <CompactButton threadId={session.threadId} disabled={session.running} />
      </div>
      <EntriesDialog category={detail} hostId={session.hostId} onClose={() => setDetail(null)} />
    </div>
  );
}

/** 分段条: 每个 used 分类按窗口占比着色, reserved 斜纹, 自动压缩阈值一条竖线 */
function ContextBar({ ctx }: { ctx: SessionContext }) {
  const window = ctx.windowTokens;
  const used = ctx.categories.filter((c) => c.kind === "used");
  const reserved = ctx.categories.filter((c) => c.kind === "reserved");
  const segments =
    used.length > 0
      ? used.map((c, i) => ({ key: c.id, width: c.tokens / window, color: categoryColor(c.label, c.kind, i) }))
      : [{ key: "used", width: ctx.usedTokens / window, color: "var(--foreground)" }];
  const marker = ctx.autoCompactAtTokens !== null ? ctx.autoCompactAtTokens / window : null;
  return (
    <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <span className="flex h-full w-full">
        {segments.map((s) => (
          <span key={s.key} className="block h-full" style={{ width: `${s.width * 100}%`, background: s.color, minWidth: s.width > 0 ? 2 : 0 }} />
        ))}
        <span className="block h-full flex-1" />
        {reserved.map((c) => (
          <span
            key={c.id}
            className="block h-full opacity-40"
            style={{
              width: `${(c.tokens / window) * 100}%`,
              backgroundImage: "repeating-linear-gradient(135deg, var(--muted-foreground) 0 2px, transparent 2px 4px)",
            }}
          />
        ))}
      </span>
      {marker !== null && marker < 1 ? (
        <span className="absolute inset-y-0 block w-px bg-foreground/60" style={{ left: `${marker * 100}%` }} />
      ) : null}
    </span>
  );
}

/** 悬停说明: 带虚线下划线的标签表示"有解释", 与 Claude Desktop 的用法一致 (不表示可点) */
const CATEGORY_HELP: Record<string, string> = {
  "Memory files": "CLAUDE.md, AGENTS.md and memory files loaded into every request",
  Skills: "Names and descriptions of the skills the agent can load",
  "MCP tools": "Tool definitions from connected MCP servers",
  "MCP server instructions": "Usage instructions each MCP server adds to the system prompt",
  "System tools": "Definitions of the agent's built-in tools",
  "Autocompact buffer": "Space kept free so the conversation can be compacted before the window fills",
};

const INLINE_ROWS = 8;

function CategoryRow({
  category,
  color,
  windowTokens,
  hostId,
  open,
  onToggle,
  onShowAll,
}: {
  category: SessionCategory;
  color: string;
  windowTokens: number;
  hostId: string | null;
  open: boolean;
  onToggle: () => void;
  onShowAll: () => void;
}) {
  const hasEntries = category.entries.length > 0;
  const hollow = category.kind === "free" || category.kind === "reserved";
  const label = displayCategoryLabel(category);
  const help = CATEGORY_HELP[label];
  const content = (
    <>
      <span
        className={cn("size-2 shrink-0 rounded-[2px]", hollow && "border border-muted-foreground/50")}
        style={hollow ? undefined : { background: color, opacity: category.kind === "deferred" ? 0.45 : 1 }}
      />
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <span
          className={cn("truncate", help && "underline decoration-muted-foreground/50 decoration-dotted underline-offset-[3px]")}
          title={help}
        >
          {label}
        </span>
        {hasEntries ? (
          <>
            <span className="shrink-0 text-[11px] text-muted-foreground">{category.entries.length}</span>
            <Icon
              name="ChevronRight"
              className={cn("size-3 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-90")}
              aria-hidden
            />
          </>
        ) : null}
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground">{formatTokens(category.tokens)}</span>
      <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
        {category.kind === "deferred" ? "—" : formatPercent(category.tokens / windowTokens)}
      </span>
    </>
  );
  const cls = "flex h-6 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs pointer-coarse:h-9";
  return (
    <div>
      {hasEntries ? (
        <button
          type="button"
          className={cn(cls, "hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-none active:scale-100 active:bg-state-active")}
          onClick={onToggle}
          aria-expanded={open}
        >
          {content}
        </button>
      ) : (
        <div className={cls}>{content}</div>
      )}
      {hasEntries ? (
        <Collapse open={open}>
          <InlineEntries category={category} hostId={hostId} onShowAll={onShowAll} />
        </Collapse>
      ) : null}
    </div>
  );
}

/** 第三层 (就地): 按占用降序的前几项, 缩进一层; 超出时给"查看全部"入口 */
function InlineEntries({ category, hostId, onShowAll }: { category: SessionCategory; hostId: string | null; onShowAll: () => void }) {
  const entries = useMemo(() => [...category.entries].sort((a, b) => b.tokens - a.tokens), [category.entries]);
  const rest = entries.length - INLINE_ROWS;
  return (
    <div className="mb-1 ml-[19px] border-l border-border pl-2">
      {entries.slice(0, INLINE_ROWS).map((entry) => (
        <div key={entry.id} className="flex h-5 items-center gap-2 pr-2 text-[11px] text-muted-foreground pointer-coarse:h-8" title={entry.label}>
          <span className="min-w-0 flex-1 truncate">
            <EntryLabel category={category} label={entry.label} hostId={hostId} />
          </span>
          <span className="shrink-0 tabular-nums">{formatTokens(entry.tokens)}</span>
        </div>
      ))}
      {rest > 0 ? (
        <button
          type="button"
          className="flex h-5 w-full items-center rounded pr-2 text-left text-[11px] text-muted-foreground hover:text-foreground active:scale-100 pointer-coarse:h-8"
          onClick={onShowAll}
          aria-haspopup="dialog"
        >
          All {entries.length} · search
        </button>
      ) : null}
    </div>
  );
}

/** 条目名称: 记忆文件是可点开预览的链接 (下划线), MCP 工具显示"工具名 + 所属 server", 其余原样 */
function EntryLabel({ category, label, hostId, onNavigate }: { category: SessionCategory; label: string; hostId: string | null; onNavigate?: () => void }) {
  if (category.label === "Memory files" && hostId && label.startsWith("/")) {
    return (
      <FileLink
        target={{ kind: "host", hostId, path: label }}
        className="text-foreground/80 underline decoration-muted-foreground/60 underline-offset-2 hover:text-foreground"
        onClick={onNavigate}
      >
        {memoryName(label)}
      </FileLink>
    );
  }
  if (/^MCP tools/i.test(category.label)) {
    return (
      <>
        <span className="text-foreground/80">{toolName(label)}</span>
        <span className="ml-1">{label.split(":")[0]}</span>
      </>
    );
  }
  return <>{label}</>;
}

/** 记忆文件的友好名 (Ghostex 的写法): 用户级 → "CLAUDE.md (user)", 自动记忆 → "MEMORY.md (memory)", 其余取末两段 */
export function memoryName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const file = parts[parts.length - 1] ?? path;
  if (/\/\.claude\/projects\/.+\/memory\//.test(path)) return `${file} (memory)`;
  if (/^\/(?:Users|home)\/[^/]+\/\.(?:claude|codex|agents)\/[^/]+$/.test(path)) return `${file} (user)`;
  return parts.slice(-2).join("/");
}

/**
 * 查看全部: 一个分类的全部条目 (146 个技能、几十个 MCP 工具), 只在就地列表放不下时才用。
 * 桌面是居中弹层, 手机是底部抽屉 (脚手架 Dialog 的响应式行为); 条目只在弹层打开时渲染, 可搜索。
 */
function EntriesDialog({ category, hostId, onClose }: { category: SessionCategory | null; hostId: string | null; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const entries = useMemo(() => {
    if (!category) return [];
    const q = query.trim().toLowerCase();
    return [...category.entries]
      .filter((e) => q === "" || e.label.toLowerCase().includes(q))
      .sort((a, b) => b.tokens - a.tokens);
  }, [category, query]);
  return (
    <Dialog
      open={category !== null}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
          setQuery("");
        }
      }}
    >
      <DialogContent className="max-w-md gap-3">
        {category ? (
          <>
            <DialogHeader>
              <DialogTitle>{displayCategoryLabel(category)}</DialogTitle>
              <DialogDescription>
                {category.entries.length} items · {formatTokens(category.tokens)} tokens
                {category.kind === "deferred" ? " · loaded only when used" : ""}
              </DialogDescription>
            </DialogHeader>
            {category.entries.length > 8 ? (
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter" aria-label="Filter items" className="h-8 text-sm" />
            ) : null}
            <div className="max-h-[50dvh] min-h-24 overflow-y-auto">
              {entries.map((entry) => (
                <div key={entry.id} className="flex min-h-7 items-center gap-3 py-0.5 text-sm pointer-coarse:min-h-9" title={entry.label}>
                  <span className="min-w-0 flex-1 truncate">
                    <EntryLabel category={category} label={entry.label} hostId={hostId} onNavigate={onClose} />
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{formatTokens(entry.tokens)}</span>
                </div>
              ))}
              {entries.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No matches</p> : null}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** 两步确认: 压缩会让 agent 总结并丢弃历史细节, 不可撤销; 文字宽度固定不跳动。Usage 分区的缓存将过期提示也用它 */
export function CompactButton({ threadId, disabled }: { threadId: string; disabled: boolean }) {
  const sdk = useSdk();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 3000);
      return;
    }
    setBusy(true);
    try {
      await sdk.threads.compact({ threadId });
      toast.success("Compacting context");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not compact the context");
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };
  return (
    <button
      type="button"
      className={cn(
        "h-5 w-[4.5rem] shrink-0 rounded border border-border text-center text-[11px] hover:bg-state-hover disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-8",
        armed ? "border-destructive/60 text-destructive" : "text-foreground",
      )}
      disabled={disabled || busy}
      onClick={() => void run()}
      aria-label={armed ? "Confirm: compact this conversation" : "Compact this conversation"}
    >
      {busy ? "…" : armed ? "Confirm" : "Compact"}
    </button>
  );
}
