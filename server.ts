/**
 * [INPUT]: 依赖 bb.sdk 的 threads (get/context/events)、environments; 依赖宿主入口 (contract.ts) 发现端口与上下文文件; 依赖 lib/usage.ts 归一用量、lib/context-estimate.ts 追踪已读并估算分类
 * [OUTPUT]: 对外提供插件工厂 (default export): 注册 rpc.ts 契约的全部 handler、线程事件驱动的失效刷新, 服务端语言配置，以及 `bb session-cockpit` CLI
 * [POS]: 插件后端入口; 消费者: components/cockpit/* (经 RPC)、agent (经 CLI); 与 host.ts 的边界: 本文件解析线程→环境→宿主机, host.ts 只在机器上执行 lsof 与读文件系统; 与 rpc.ts 的边界: 契约形状在 rpc.ts, 本文件只实现
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { ESTIMATE_EVENTS, contextFileUsage, estimateCategories, messageEstimates, scanWindowActivity, shouldEstimate, type WindowActivity } from "./lib/context-estimate";
import { fileUsageSummary, loadedEntries } from "./lib/context-files";
import { LANGUAGE_MODES, languageMode } from "./lib/i18n";
import { hostContract, type ListenerInfo } from "./contract";
import {
  rpcContract,
  scriptSchema,
  type ContextFilesResult,
  type ProjectScript,
  type ServersResult,
  type SessionSnapshot,
} from "./rpc";
import {
  groupConnectors,
  hitRate,
  sortCategories,
  summarizeEvents,
  type ContextCategory,
  type UsageEvent,
} from "./lib/usage";
import {
  formatCost,
  formatCountdown,
  formatDuration,
  formatPercent,
  formatTokens,
} from "./lib/format";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const USAGE_TYPES = ["thread/tokenUsage/updated"] as const;
const TURN_TYPES = ["turn/started", "turn/completed"] as const;
/** 事件接口单页上限 100; 回合计时最多向前翻 5 页 (约 250 个回合), 更早的回合不计入 */
const EVENT_PAGE_SIZE = 100;
const TURN_EVENT_PAGES = 5;
/** 线程事件流每秒最多一次通知; 面板再节流到每 3 秒刷新一次快照 */
const SESSION_REFRESH_MS = 3000;
/** 上下文文件: 后端按宿主机 + 工作区缓存 15 秒 (宿主端自己也缓存 15 秒); 回合结束时清掉, "有改动"才显得新 */
const CONTEXT_FILES_CACHE_MS = 15_000;
const MAX_SCRIPTS = 50;
const SIDE_CHAT_PLUGIN = "side-chat";

type ThreadDto = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["get"]>>;

// ---------------------------------------------------------------------------
// 插件工厂
// ---------------------------------------------------------------------------

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    language: { type: "select", label: "Language", options: [...LANGUAGE_MODES], default: "auto" },
  });
  settings.onChange(() => bb.rpc.experimental_invalidate(["language"]));
  const host = bb.hosts.experimental_client({ contract: hostContract });

  // ----- 线程 → 环境解析 -----

  async function resolveThread(threadId: string, signal?: AbortSignal) {
    const thread: ThreadDto = await bb.sdk.threads.get({ threadId, signal });
    const environment = thread.environmentId
      ? await bb.sdk.environments
          .get({ environmentId: thread.environmentId, signal })
          .catch(() => null)
      : null;
    return {
      thread,
      hostId: environment?.hostId ?? null,
      environmentId: environment?.id ?? null,
      environmentPath: environment?.path ?? null,
    };
  }

  const toMs = (iso: string | undefined | null): number | null => {
    if (!iso) return null;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
  };

  const asUsageEvents = (events: readonly { type: string; createdAt: number; data: unknown }[]): UsageEvent[] =>
    events.map((e) => ({ type: e.type, createdAt: e.createdAt, data: e.data }));

  type EventQuery = Parameters<typeof bb.sdk.threads.events.list>[0];

  async function recentEvents(query: EventQuery, pages: number) {
    let beforeSeq = query.beforeSeq;
    const all: Awaited<ReturnType<typeof bb.sdk.threads.events.list>>[number][] = [];
    for (let page = 0; page < pages; page++) {
      const batch = await bb.sdk.threads.events.list({
        ...query, order: "desc", limit: String(EVENT_PAGE_SIZE), beforeSeq,
      });
      all.push(...batch);
      if (batch.length < EVENT_PAGE_SIZE) break;
      beforeSeq = String(batch[batch.length - 1]!.seq);
    }
    return all;
  }

  const activityCache = new Map<string, { root: string | null; includeMessages: boolean; activity: WindowActivity }>();
  async function readActivity(threadId: string, root: string | null, includeMessages: boolean, signal?: AbortSignal) {
    const types = includeMessages ? ESTIMATE_EVENTS : ["item/completed", "thread/compacted", "thread/context/cleared"] as const;
    const query = { threadId, types, order: "desc" as const, signal };
    const [head] = await bb.sdk.threads.events.list({ ...query, limit: "1" });
    if (!head) return null;
    const cached = activityCache.get(threadId);
    const previous = cached?.root === root && cached.includeMessages === includeMessages ? cached.activity : undefined;
    const activity = await scanWindowActivity(head.seq, EVENT_PAGE_SIZE, before => bb.sdk.threads.events.list({
      ...query, limit: String(EVENT_PAGE_SIZE), beforeSeq: before === undefined ? undefined : String(before),
    }), root, includeMessages ? 300 : 0, previous);
    // 只保留路径与数字；并发请求不能用旧事件覆盖已完成的新扫描。
    if ((activityCache.get(threadId)?.activity.seq ?? 0) <= head.seq) {
      activityCache.set(threadId, { root, includeMessages, activity });
      if (activityCache.size > 64) activityCache.delete(activityCache.keys().next().value!);
    }
    return activity;
  }

  // ----- 会话快照 -----

  async function buildSession(threadId: string, signal?: AbortSignal): Promise<SessionSnapshot> {
    const [resolved, context, usage, turns] = await Promise.all([
      resolveThread(threadId, signal),
      bb.sdk.threads.context({ threadId, signal }).catch(() => ({ usage: null })),
      bb.sdk.threads.events.list({ threadId, types: [...USAGE_TYPES], order: "desc", limit: "1", signal }),
      recentEvents({ threadId, types: TURN_TYPES, signal }, TURN_EVENT_PAGES),
    ]);
    const { thread } = resolved;
    const summary = summarizeEvents(asUsageEvents([...usage, ...turns]));
    const ctx = context.usage;
    const snapshot = ctx?.snapshot;
    const official = snapshot ? sortCategories(snapshot.categories) : [];
    const usedTokens = snapshot?.usedTokens ?? ctx?.usedTokens ?? 0;
    const windowTokens = snapshot?.contextWindowTokens ?? ctx?.modelContextWindow ?? 0;
    const breakdownEstimated = shouldEstimate(thread.providerId, windowTokens, official);
    const [workspace, activity] = await Promise.all([
      workspaceContextFiles(resolved),
      readActivity(threadId, resolved.environmentPath, breakdownEstimated, signal).catch(() => null),
    ]);
    signal?.throwIfAborted();
    const officialFiles = loadedEntries({ categories: official });
    const { stats, accountedPaths } = contextFileUsage(workspace.files, activity?.paths ?? new Set(), officialFiles, thread.providerId);
    let categories: ContextCategory[] = official;
    if (breakdownEstimated) {
      const messages = activity ? messageEstimates(activity.messages, accountedPaths) : [];
      categories = estimateCategories(usedTokens, windowTokens, messages, stats.entries.map(entry => ({ ...entry, id: entry.path })));
      // Workspace 与 Usage 共用预算取整后的条目。
      stats.entries = stats.entries.map((entry, index) => ({ ...entry, tokens: categories[1]!.entries[index]!.tokens }));
    }

    return {
      threadId,
      projectId: thread.projectId,
      providerId: thread.providerId,
      status: thread.status,
      running: thread.status === "active" || thread.status === "starting",
      createdAt: thread.createdAt,
      hostId: resolved.hostId,
      environmentId: resolved.environmentId,
      environmentPath: resolved.environmentPath,
      contextFiles: workspace.hostId ? stats : null,
      context: ctx
        ? {
            usedTokens,
            windowTokens,
            ...(breakdownEstimated && { breakdownEstimated }),
            estimated: snapshot?.estimated ?? ctx.estimated,
            model: snapshot?.model ?? null,
            capturedAt: toMs(snapshot?.capturedAt),
            autoCompactAtTokens: snapshot?.autoCompactAtTokens ?? null,
            categories,
            cost: ctx.cost ?? null,
            compactionOfferAt: toMs(ctx.compactionOfferAt),
          }
        : null,
      tokens: {
        semantics: summary.tokens.semantics,
        lastTurn: summary.tokens.lastTurn,
        session: summary.tokens.session,
        updatedAt: summary.tokens.updatedAt,
        promptCacheTtlMs: summary.tokens.promptCacheTtlMs,
      },
      turns: summary.turns,
      connectors: groupConnectors(official),
      generatedAt: Date.now(),
    };
  }

  // ----- Servers -----

  async function listServers(threadId: string, signal?: AbortSignal): Promise<ServersResult> {
    const { hostId, environmentPath } = await resolveThread(threadId, signal);
    if (!hostId || !environmentPath) {
      return { supported: false, reason: "This thread has no workspace on a machine yet." };
    }
    const result = await host.call("listListeners", { root: environmentPath }, { hostId, signal });
    return result.supported
      ? { supported: true, root: environmentPath, servers: result.listeners }
      : { supported: false, reason: result.reason };
  }

  // ----- Side chats: bb 内置 side-chat 插件建的隐藏 fork, 它本身不提供"本线程有哪些 side chat"的列表 -----

  async function listSideChats(threadId: string, signal?: AbortSignal) {
    const rows = await bb.sdk.threads.list({
      sourceThreadId: threadId,
      originKind: "fork",
      originPluginId: SIDE_CHAT_PLUGIN,
      includeHidden: true,
      archived: false,
      limit: 50,
      signal,
    });
    return {
      chats: rows
        .map((t) => ({ id: t.id, title: t.title ?? null, status: t.status, updatedAt: t.updatedAt }))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    };
  }

  // ----- 项目脚本 (按项目存 kv) -----

  const scriptsKey = (projectId: string) => `scripts:${projectId}`;
  async function readScripts(projectId: string): Promise<ProjectScript[]> {
    const stored = await bb.storage.kv.get<unknown>(scriptsKey(projectId));
    const parsed = z.array(scriptSchema).safeParse(stored);
    return parsed.success ? parsed.data : [];
  }
  async function writeScripts(projectId: string, scripts: ProjectScript[]) {
    await bb.storage.kv.set(scriptsKey(projectId), scripts);
    bb.rpc.experimental_invalidate([scriptsKey(projectId)]);
  }

  // ----- 上下文文件 (发现在宿主机上做: 文件在那台机器上) -----

  type HostContextFiles = Omit<ContextFilesResult, "hostId">;
  const contextFilesCache = new Map<string, { at: number; value: Promise<HostContextFiles> }>();

  async function workspaceContextFiles({ hostId, environmentPath }: Awaited<ReturnType<typeof resolveThread>>): Promise<ContextFilesResult> {
    const empty: HostContextFiles = { isGitRepo: false, files: [] };
    if (!hostId || !environmentPath) return { hostId: hostId ?? null, ...empty };
    const key = `${hostId}:${environmentPath}`;
    let entry = contextFilesCache.get(key);
    if (!entry || Date.now() - entry.at >= CONTEXT_FILES_CACHE_MS) {
      // 多个窗格、同工作区的多条线程共用一次调用, 所以不绑定单次请求的 signal
      const fresh = { at: Date.now(), value: host.call("listContextFiles", { root: environmentPath }, { hostId }) };
      contextFilesCache.set(key, fresh);
      // 宿主机不可达时不留坏缓存, 下次重试
      fresh.value.catch(() => contextFilesCache.get(key) === fresh && contextFilesCache.delete(key));
      entry = fresh;
    }
    return { hostId, ...(await entry.value.catch(() => empty)) };
  }

  // ----- RPC -----

  bb.rpc.register(rpcContract, {
    language: async () => ({ language: languageMode((await settings.get()).language) }),
    setLanguage: async ({ language }) => ({ language: languageMode((await settings.experimental_set({ language })).language) }),
    session: ({ threadId }, ctx) => buildSession(threadId, ctx.experimental_signal),
    contextFiles: async ({ threadId }, ctx) => workspaceContextFiles(await resolveThread(threadId, ctx.experimental_signal)),
    servers: ({ threadId }, ctx) => listServers(threadId, ctx.experimental_signal),
    sideChats: ({ threadId }, ctx) => listSideChats(threadId, ctx.experimental_signal),
    stopServer: async ({ threadId, pid, port }, ctx) => {
      const { hostId, environmentPath } = await resolveThread(threadId, ctx.experimental_signal);
      if (!hostId || !environmentPath) {
        return { stopped: false, message: "This thread has no workspace on a machine." };
      }
      const result = await host.call("stopListener", { root: environmentPath, pid, port }, { hostId });
      bb.rpc.experimental_invalidate([`servers:${threadId}`]);
      return result;
    },
    scripts: async ({ projectId }) => ({ scripts: await readScripts(projectId) }),
    saveScript: async ({ projectId, id, name, command, previewUrl }) => {
      const scripts = await readScripts(projectId);
      const existing = id ? scripts.find((s) => s.id === id) : undefined;
      if (!existing && scripts.length >= MAX_SCRIPTS) {
        throw new Error(`A project can keep at most ${MAX_SCRIPTS} scripts.`);
      }
      const script: ProjectScript = existing
        ? { ...existing, name, command, previewUrl: previewUrl ?? null }
        : { id: randomUUID().slice(0, 8), name, command, previewUrl: previewUrl ?? null, createdAt: Date.now() };
      await writeScripts(
        projectId,
        existing ? scripts.map((s) => (s.id === script.id ? script : s)) : [...scripts, script],
      );
      return script;
    },
    removeScript: async ({ projectId, id }) => {
      const scripts = await readScripts(projectId);
      const remaining = scripts.filter((s) => s.id !== id);
      if (remaining.length === scripts.length) return { removed: false };
      await writeScripts(projectId, remaining);
      return { removed: true };
    },
  });

  // ----- 失效刷新: 线程事件推进 → 快照过期 -----

  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const lastFlush = new Map<string, number>();
  function scheduleRefresh(threadId: string) {
    if (pending.has(threadId)) return;
    const wait = Math.max(0, (lastFlush.get(threadId) ?? 0) + SESSION_REFRESH_MS - Date.now());
    pending.set(
      threadId,
      setTimeout(() => {
        pending.delete(threadId);
        lastFlush.set(threadId, Date.now());
        bb.rpc.experimental_invalidate([`thread:${threadId}`]);
      }, wait),
    );
  }
  bb.events.on("experimental_thread.events", ({ thread }) => scheduleRefresh(thread.id));
  // side chat 的增删与状态变化刷新其来源线程的列表
  const touchSideChat = (thread: { sourceThreadId: string | null; originPluginId: string | null }) => {
    if (thread.originPluginId === SIDE_CHAT_PLUGIN && thread.sourceThreadId) {
      bb.rpc.experimental_invalidate([`sidechats:${thread.sourceThreadId}`]);
    }
  };
  bb.events.on("thread.created", ({ thread }) => touchSideChat(thread));
  bb.events.on("thread.archived", ({ thread }) => touchSideChat(thread));
  bb.events.on("thread.unarchived", ({ thread }) => touchSideChat(thread));
  // 状态切换 (开始/结束回合) 立即刷新, 不等节流; 回合结束时限额也可能变化
  bb.events.on("thread.active", ({ thread }) => {
    touchSideChat(thread);
    bb.rpc.experimental_invalidate([`thread:${thread.id}`]);
  });
  bb.events.on("thread.idle", ({ thread }) => {
    touchSideChat(thread);
    // 回合里 agent 可能改了上下文文件: 先清缓存再通知, 否则重取拿到的还是旧的
    contextFilesCache.clear();
    bb.rpc.experimental_invalidate([`thread:${thread.id}`, `contextfiles:${thread.id}`]);
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    touchSideChat(thread);
    activityCache.delete(thread.id);
    lastFlush.delete(thread.id);
    const timer = pending.get(thread.id);
    if (timer) clearTimeout(timer);
    pending.delete(thread.id);
  });

  bb.onDispose(() => {
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
    activityCache.clear();
    lastFlush.clear();
    contextFilesCache.clear();
  });

  // ----- CLI: 给 agent 自查上下文/缓存 -----

  const usage = [
    "Usage:",
    "  bb session-cockpit summary [--thread <id>] [--json]   Context, cache and tokens of a thread",
    "  bb session-cockpit servers [--thread <id>] [--json]   Servers listening inside the thread's workspace",
    "Inside a thread, --thread defaults to the current thread.",
  ].join("\n");

  bb.cli.register({
    name: "session-cockpit",
    summary: "Inspect a thread's context window, prompt cache, token usage and dev servers",
    commands: [
      { name: "summary", summary: "Context, cache and tokens", usage: "bb session-cockpit summary [--thread <id>] [--json]" },
      { name: "servers", summary: "Servers listening inside the thread's workspace", usage: "bb session-cockpit servers [--thread <id>] [--json]" },
    ],
    async run(argv, ctx) {
      const json = argv.includes("--json");
      const args = argv.filter((a) => a !== "--json");
      const command = args[0];
      const flagIndex = args.indexOf("--thread");
      const threadId = flagIndex >= 0 ? args[flagIndex + 1] : ctx.threadId;
      if (command === undefined || command === "help" || command === "--help") {
        return { exitCode: 0, stdout: usage };
      }
      if (!threadId) {
        return { exitCode: 1, stderr: "Pass --thread <id>, or run this inside a bb thread." };
      }
      if (command === "summary") {
        const session = await buildSession(threadId, ctx.signal);
        if (json) return { exitCode: 0, stdout: JSON.stringify(summaryJson(session)) };
        return { exitCode: 0, stdout: summaryText(session) };
      }
      if (command === "servers") {
        const result = await listServers(threadId, ctx.signal);
        if (json) return { exitCode: 0, stdout: JSON.stringify(result) };
        if (!result.supported) return { exitCode: 0, stdout: result.reason };
        if (result.servers.length === 0) return { exitCode: 0, stdout: `No servers listening in ${result.root}.` };
        return { exitCode: 0, stdout: result.servers.map((s) => serverLine(s, threadId)).join("\n") };
      }
      return { exitCode: 1, stderr: usage };
    },
  });
}

// ---------------------------------------------------------------------------
// CLI 文本 (有界输出: 分类明细只列前几项)
// ---------------------------------------------------------------------------

/** `http://localhost:5173  Web: node (pid 123)  [started by claude] [other thread thr_x]`; docker 行没有 pid, 显示容器名 */
function serverLine(s: ListenerInfo, threadId: string): string {
  const who = s.container ? `container ${s.container}` : `pid ${s.pid}`;
  const owner = s.owner === "agent-child" ? `started by ${s.ownerAgent}` : s.owner === "agent" ? "agent session" : s.owner;
  const elsewhere = s.threadId !== null && s.threadId !== threadId ? ` [other thread ${s.threadId}]` : "";
  return `${s.url}  ${s.name ? `${s.name}: ` : ""}${s.label} (${who})  [${owner}]${elsewhere}${s.http === false ? " [not HTTP]" : ""}`;
}

function summaryJson(session: SessionSnapshot) {
  // CLI JSON 省略逐条明细, 避免输出过大; 明细在面板里看
  const context = session.context
    ? {
        ...session.context,
        categories: session.context.categories.map(({ entries, ...rest }) => ({
          ...rest,
          entryCount: entries.length,
        })),
      }
    : null;
  const stats = session.contextFiles;
  const contextFiles = stats ? { total: stats.total, basis: stats.basis, ...fileUsageSummary(stats, context?.windowTokens ?? 0) } : null;
  return { ...session, context, contextFiles };
}

function summaryText(session: SessionSnapshot): string {
  const now = Date.now();
  const lines: string[] = [];
  const ctx = session.context;
  if (ctx) {
    lines.push(
      `Context: ${formatTokens(ctx.usedTokens)} / ${formatTokens(ctx.windowTokens)} (${formatPercent(ctx.usedTokens / ctx.windowTokens)})${ctx.estimated ? " estimated" : ""}${ctx.model ? ` · ${ctx.model}` : ""}`,
    );
    if (ctx.breakdownEstimated) lines.push("  Estimated breakdown");
    for (const c of ctx.categories.filter((c) => c.kind === "used").slice(0, 8)) {
      lines.push(`  ${c.label}: ${formatTokens(c.tokens)}`);
    }
    if (ctx.autoCompactAtTokens) lines.push(`  Auto-compacts at ${formatTokens(ctx.autoCompactAtTokens)}`);
    if (ctx.cost) lines.push(`Cost: ${formatCost(ctx.cost)}`);
  } else {
    lines.push("Context: not measured yet");
  }
  if (session.contextFiles) {
    const { count, ratio, estimated } = fileUsageSummary(session.contextFiles, ctx?.windowTokens ?? 0);
    lines.push(`Context files: ${count} loaded${ratio === null ? "" : ` · ${estimated ? "≈" : ""}${formatPercent(ratio)} of window`}`);
  }
  const t = session.tokens;
  if (t.session) {
    lines.push(
      `Session tokens: ${formatTokens(t.session.total)} total · cache hit ${formatPercent(hitRate(t.session))} · read ${formatTokens(t.session.cacheRead)} · write ${formatTokens(t.session.cacheWrite)} · output ${formatTokens(t.session.output)}`,
    );
  }
  if (session.running) lines.push("Prompt cache: in use (turn running)");
  else if (t.updatedAt !== null && t.promptCacheTtlMs !== null) {
    const expires = session.context?.compactionOfferAt ?? t.updatedAt + t.promptCacheTtlMs;
    lines.push(expires > now ? `Prompt cache: warm, expires in ${formatCountdown(expires, now)}` : "Prompt cache: cold");
  }
  lines.push(
    `Time: session ${formatDuration(now - session.createdAt)} · agent working ${formatDuration(session.turns.workingMs)} over ${session.turns.completed} turns`,
  );
  return lines.join("\n");
}
