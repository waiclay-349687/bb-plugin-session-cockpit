/**
 * [INPUT]: 依赖 bb 线程事件 (thread/tokenUsage/updated、turn/*) 与 threads.context() 的原始 JSON
 * [OUTPUT]: 对外提供 normalizeTokens / summarizeEvents / groupConnectors / cacheState / sortCategories 等纯函数: 把各家 provider 口径不一的用量数据归一成面板可直接渲染的结构
 *           分类条目允许附带文件路径和统计来源。
 * [POS]: lib 层的领域核心, 无 IO; 消费者: server.ts (组装快照)、app 组件 (缓存倒计时)、test/usage.test.ts; 与 lib/format.ts 的边界: 本文件只算数, 不做显示格式化
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */

// ---------------------------------------------------------------------------
// Token 用量归一
// ---------------------------------------------------------------------------

/** 归一后的 token 计数: prompt = uncachedInput + cacheRead + cacheWrite。 */
export interface NormalizedTokens {
  uncachedInput: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  prompt: number;
  total: number;
}

/**
 * inputTokens 是否已包含缓存部分, 各家口径不同:
 * - exclusive (Claude Code): total = input + cached + output
 * - inclusive (Codex):       total = input + output, 且 input 已含 cached
 * 只按 total 满足哪条恒等式判定, 不按 provider 名硬编码, 新 provider 接入也能自动归类。
 */
export type InputSemantics = "exclusive" | "inclusive" | "unknown";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

/** 非负有限数, 否则 null; 所有外部数字都过这一道。 */
export const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;

export function detectSemantics(raw: unknown): InputSemantics {
  const r = asRecord(raw);
  const total = count(r.totalTokens);
  const input = count(r.inputTokens);
  const cached = count(r.cachedInputTokens) ?? 0;
  const output = count(r.outputTokens) ?? 0;
  if (total === null || input === null) return "unknown";
  if (cached === 0) return "exclusive"; // 无缓存时两种口径等价
  if (total === input + cached + output) return "exclusive";
  if (total === input + output && input >= cached) return "inclusive";
  return "unknown";
}

export function normalizeTokens(
  raw: unknown,
  semantics: InputSemantics = detectSemantics(raw),
): NormalizedTokens | null {
  const r = asRecord(raw);
  const input = count(r.inputTokens);
  if (input === null) return null;
  const cached = count(r.cachedInputTokens) ?? 0;
  // 老版本事件只给 cachedInputTokens, 视作全是读命中
  const cacheRead = count(r.cacheReadInputTokens) ?? cached;
  const cacheWrite =
    count(r.cacheWriteInputTokens) ?? Math.max(0, cached - cacheRead);
  const uncachedInput =
    semantics === "inclusive" ? Math.max(0, input - cached) : input;
  const output = count(r.outputTokens) ?? 0;
  const reasoning = count(r.reasoningOutputTokens) ?? 0;
  const prompt = uncachedInput + cacheRead + cacheWrite;
  return {
    uncachedInput,
    cacheRead,
    cacheWrite,
    output,
    reasoning,
    prompt,
    total: count(r.totalTokens) ?? prompt + output,
  };
}

/** 缓存命中率 = 读命中 / 全部 prompt token; prompt 为 0 时无意义返回 null。 */
export function hitRate(tokens: NormalizedTokens | null): number | null {
  if (tokens === null || tokens.prompt === 0) return null;
  return tokens.cacheRead / tokens.prompt;
}

// ---------------------------------------------------------------------------
// 事件流汇总
// ---------------------------------------------------------------------------

export interface UsageEvent {
  type: string;
  createdAt: number;
  data: unknown;
}

export interface TurnSummary {
  /** 已完成回合数 (窗口内) */
  completed: number;
  /** 已完成回合的累计耗时 */
  workingMs: number;
  /** 正在进行的回合起点; 无则 null */
  activeSince: number | null;
  lastCompletedAt: number | null;
}

export interface TokenSummary {
  semantics: InputSemantics;
  /** Claude Code 的 last 是"上一回合"聚合值, 不是单次请求, 也不能当上下文大小用 */
  lastTurn: NormalizedTokens | null;
  session: NormalizedTokens | null;
  updatedAt: number | null;
  promptCacheTtlMs: number | null;
  modelContextWindow: number | null;
}

export interface EventSummary {
  tokens: TokenSummary;
  turns: TurnSummary;
}

/** 事件可乱序传入; 内部按时间升序扫描一次。 */
export function summarizeEvents(events: readonly UsageEvent[]): EventSummary {
  const ordered = [...events].sort((a, b) => a.createdAt - b.createdAt);
  let usage: JsonRecord | null = null;
  let usageAt: number | null = null;
  let turnStart: number | null = null;
  const turns: TurnSummary = {
    completed: 0,
    workingMs: 0,
    activeSince: null,
    lastCompletedAt: null,
  };

  for (const event of ordered) {
    switch (event.type) {
      case "thread/tokenUsage/updated":
        usage = asRecord(asRecord(event.data).tokenUsage);
        usageAt = event.createdAt;
        break;
      case "turn/started":
        turnStart = event.createdAt;
        break;
      case "turn/completed":
        if (turnStart !== null) {
          turns.workingMs += Math.max(0, event.createdAt - turnStart);
          turns.completed += 1;
        }
        turns.lastCompletedAt = event.createdAt;
        turnStart = null;
        break;
    }
  }
  turns.activeSince = turnStart;

  const total = usage?.total;
  const last = usage?.last;
  // 口径按 session total 判定 (数值大、恒等式更稳), 再套用到 last
  const semantics =
    detectSemantics(total) !== "unknown"
      ? detectSemantics(total)
      : detectSemantics(last);

  return {
    tokens: {
      semantics,
      lastTurn: normalizeTokens(last, semantics),
      session: normalizeTokens(total, semantics),
      updatedAt: usageAt,
      promptCacheTtlMs: count(usage?.promptCacheTtlMs),
      modelContextWindow: count(usage?.modelContextWindow),
    },
    turns,
  };
}

// ---------------------------------------------------------------------------
// 上下文分类 (Claude Code 的 /context 明细)
// ---------------------------------------------------------------------------

export type CategoryKind = "used" | "reserved" | "free" | "deferred";

export interface ContextEntry {
  path?: string;
  source?: "official" | "read" | "startup";
  id: string;
  label: string;
  tokens: number;
}

export interface ContextCategory {
  id: string;
  label: string;
  kind: CategoryKind;
  tokens: number;
  entries: ContextEntry[];
}

const KIND_ORDER: Record<CategoryKind, number> = {
  used: 0,
  reserved: 1,
  free: 2,
  deferred: 3,
};

/** 与 Claude Desktop 一致: used 按占用降序, 其后 reserved、free, deferred 单列在最后。 */
export function sortCategories(
  categories: readonly ContextCategory[],
): ContextCategory[] {
  return [...categories].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.tokens - a.tokens,
  );
}

/** "(deferred)" 后缀是 provider 给的区分标签, UI 里已有分组就不再重复显示。 */
export const displayCategoryLabel = (category: ContextCategory): string =>
  category.kind === "deferred"
    ? category.label.replace(/\s*\(deferred\)$/i, "")
    : category.label;

// ---------------------------------------------------------------------------
// 连接器 (MCP server) 推断
// ---------------------------------------------------------------------------

export interface ConnectorSummary {
  name: string;
  loadedTools: number;
  deferredTools: number;
  tokens: number;
}

/**
 * bb 不暴露 MCP 连接状态, 只能从上下文明细里的工具条目反推:
 * 条目 label 形如 "pencil: mcp__pencil__batch_get"。连不上的 server 不会出现在这里。
 */
export function groupConnectors(
  categories: readonly ContextCategory[],
): ConnectorSummary[] {
  const byName = new Map<string, ConnectorSummary>();
  for (const category of categories) {
    if (!/^MCP tools/i.test(category.label)) continue;
    const deferred = category.kind === "deferred";
    for (const entry of category.entries) {
      const name = connectorName(entry.label);
      const current = byName.get(name) ?? {
        name,
        loadedTools: 0,
        deferredTools: 0,
        tokens: 0,
      };
      if (deferred) current.deferredTools += 1;
      else current.loadedTools += 1;
      current.tokens += entry.tokens;
      byName.set(name, current);
    }
  }
  return [...byName.values()].sort(
    (a, b) => b.loadedTools - a.loadedTools || b.tokens - a.tokens,
  );
}

export function connectorName(label: string): string {
  const prefix = label.split(":")[0]?.trim();
  if (prefix && prefix !== label) return prefix;
  const match = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(label);
  return match?.[1] ?? label;
}

/** "pencil: mcp__pencil__batch_get" → "batch_get" */
export function toolName(label: string): string {
  const tail = label.includes(":") ? label.slice(label.indexOf(":") + 1) : label;
  const trimmed = tail.trim();
  const match = /^mcp__.+?__(.+)$/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

// ---------------------------------------------------------------------------
// Prompt 缓存冷热
// ---------------------------------------------------------------------------

export type CacheState =
  | { kind: "in-use" }
  | { kind: "warm"; expiresAt: number; remainingMs: number }
  | { kind: "cold"; expiredAt: number }
  | { kind: "unknown"; reason: "no-ttl" | "no-usage" };

/**
 * 缓存冷热只能推算: 最后一次用量上报时间 + provider 声明的 TTL。
 * 回合进行中视为 in-use (每次请求都会续期)。bb 的 compactionOfferAt 实验开着时以它为准。
 */
export function cacheState(input: {
  now: number;
  running: boolean;
  lastUsageAt: number | null;
  ttlMs: number | null;
  compactionOfferAt?: number | null;
}): CacheState {
  if (input.running) return { kind: "in-use" };
  if (input.lastUsageAt === null) return { kind: "unknown", reason: "no-usage" };
  const expiresAt =
    input.compactionOfferAt ??
    (input.ttlMs === null ? null : input.lastUsageAt + input.ttlMs);
  if (expiresAt === null) return { kind: "unknown", reason: "no-ttl" };
  const remainingMs = expiresAt - input.now;
  return remainingMs > 0
    ? { kind: "warm", expiresAt, remainingMs }
    : { kind: "cold", expiredAt: expiresAt };
}
