// 用真实线程事件样本 (test/fixtures, 只保留用量类事件) 校验归一逻辑。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cacheState,
  connectorName,
  detectSemantics,
  groupConnectors,
  hitRate,
  normalizeTokens,
  sortCategories,
  summarizeEvents,
  toolName,
  type ContextCategory,
  type UsageEvent,
} from "../lib/usage.ts";
import {
  formatCountdown,
  formatDuration,
  formatPercent,
  formatTokens,
  formatTtl,
} from "../lib/format.ts";

const fixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  ) as T;

const claudeEvents = fixture<UsageEvent[]>("claude-code-events.json");
const codexEvents = fixture<UsageEvent[]>("codex-events.json");
const claudeContext = fixture<{
  usage: { snapshot: { categories: ContextCategory[] } };
}>("claude-code-context.json");

test("Claude Code 的 inputTokens 不含缓存 (exclusive)", () => {
  const summary = summarizeEvents(claudeEvents);
  assert.equal(summary.tokens.semantics, "exclusive");
  const session = summary.tokens.session!;
  assert.equal(session.uncachedInput, 22);
  assert.equal(session.cacheRead, 505666);
  assert.equal(session.cacheWrite, 72016);
  assert.equal(session.prompt, 22 + 505666 + 72016);
  // 命中率 ≈ 87.5%
  assert.ok(Math.abs(hitRate(session)! - 0.8748) < 0.001);
  assert.equal(summary.tokens.promptCacheTtlMs, 3_600_000);
});

test("Codex 的 inputTokens 已含缓存 (inclusive)", () => {
  const summary = summarizeEvents(codexEvents);
  assert.equal(summary.tokens.semantics, "inclusive");
  const session = summary.tokens.session!;
  assert.equal(session.uncachedInput, 3004300 - 2893312);
  assert.equal(session.cacheRead, 2893312);
  assert.equal(session.cacheWrite, 0);
  // 命中率 ≈ 96.3%
  assert.ok(Math.abs(hitRate(session)! - 0.9631) < 0.001);
  assert.equal(summary.tokens.promptCacheTtlMs, null);
});

test("无缓存时两种口径等价, 归为 exclusive", () => {
  const raw = { totalTokens: 150, inputTokens: 100, outputTokens: 50 };
  assert.equal(detectSemantics(raw), "exclusive");
  assert.equal(normalizeTokens(raw)!.prompt, 100);
});

test("缺字段或非法数字不抛错", () => {
  assert.equal(normalizeTokens(null), null);
  assert.equal(normalizeTokens({ inputTokens: -1 }), null);
  assert.equal(detectSemantics({ inputTokens: Number.NaN }), "unknown");
  assert.equal(hitRate(null), null);
});

test("回合计时: 成对 started/completed 累加, 未结束的记为进行中", () => {
  const events: UsageEvent[] = [
    { type: "turn/started", createdAt: 1000, data: {} },
    { type: "turn/completed", createdAt: 4000, data: {} },
    { type: "turn/started", createdAt: 10_000, data: {} },
  ];
  const { turns } = summarizeEvents(events);
  assert.equal(turns.completed, 1);
  assert.equal(turns.workingMs, 3000);
  assert.equal(turns.activeSince, 10_000);
  assert.equal(turns.lastCompletedAt, 4000);
});

test("上下文分类排序: used 降序, 其后 reserved/free, deferred 最后", () => {
  const sorted = sortCategories(claudeContext.usage.snapshot.categories);
  const kinds = sorted.map((c) => c.kind);
  assert.deepEqual(
    [...new Set(kinds)],
    ["used", "reserved", "free", "deferred"],
  );
  const used = sorted.filter((c) => c.kind === "used");
  assert.equal(used[0]!.label, "Messages");
  for (let i = 1; i < used.length; i++) {
    assert.ok(used[i - 1]!.tokens >= used[i]!.tokens);
  }
});

test("连接器从 MCP 工具条目反推", () => {
  const connectors = groupConnectors(claudeContext.usage.snapshot.categories);
  const names = connectors.map((c) => c.name);
  // 样本里的 server 名已脱敏为 alpha/beta/gamma/delta
  assert.equal(names[0], "alpha"); // 唯一有已加载工具的 server 排第一
  assert.deepEqual([...names].sort(), ["alpha", "beta", "delta", "gamma"]);
  const loaded = connectors[0]!;
  assert.equal(loaded.loadedTools, 1);
  assert.equal(loaded.deferredTools, 0);
  assert.equal(connectorName("pencil: mcp__pencil__batch_get"), "pencil");
  assert.equal(toolName("pencil: mcp__pencil__batch_get"), "batch_get");
  assert.equal(toolName("mcp__yab-browser__open"), "open");
});

test("缓存冷热推算", () => {
  const base = { lastUsageAt: 0, ttlMs: 3_600_000 };
  assert.deepEqual(cacheState({ ...base, now: 1, running: true }), {
    kind: "in-use",
  });
  const warm = cacheState({ ...base, now: 600_000, running: false });
  assert.equal(warm.kind, "warm");
  assert.equal(warm.kind === "warm" && warm.remainingMs, 3_000_000);
  assert.equal(
    cacheState({ ...base, now: 3_600_001, running: false }).kind,
    "cold",
  );
  assert.deepEqual(
    cacheState({ now: 5, running: false, lastUsageAt: 0, ttlMs: null }),
    { kind: "unknown", reason: "no-ttl" },
  );
  // compactionOfferAt 优先于 TTL 推算
  const offer = cacheState({
    ...base,
    now: 0,
    running: false,
    compactionOfferAt: 1000,
  });
  assert.equal(offer.kind === "warm" && offer.expiresAt, 1000);
});

test("显示格式", () => {
  assert.equal(formatTokens(135_800), "135.8k");
  assert.equal(formatTokens(1_000_000), "1M");
  assert.equal(formatTokens(612), "612");
  assert.equal(formatPercent(0.088), "8.8%");
  assert.equal(formatPercent(0.0004), "<0.1%");
  assert.equal(formatDuration(3 * 3600_000 + 34 * 60_000), "3h 34m");
  assert.equal(formatCountdown(10, 20), "now");
  assert.equal(formatTtl(3_600_000), "1 hour");
  assert.equal(formatTtl(300_000), "5 minutes");
});
