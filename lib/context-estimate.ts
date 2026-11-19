/**
 * [INPUT]: BB 逆序线程事件、宿主扫描的上下文文件元数据与 provider 的窗口用量
 * [OUTPUT]: shouldEstimate 选择兜底路径，messageEstimates 汇总可见内容，estimateCategories 将消息与文件估算分配到真实用量预算
 * [POS]: lib 层的兜底分类计算，由 server.ts 在缺少官方分类时调用；usage.ts 处理官方用量
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import type { ContextCategory, ContextEntry } from "./usage";
import type { ContextFile } from "./context-files";

export const ESTIMATE_EVENTS = [
  "client/turn/requested", "turn/input/accepted", "item/completed", "thread/compacted", "thread/context/cleared",
] as const;

type EstimateEvent = { type: string; data: unknown; scope?: { turnId?: string; kind: string } };
type Data = Record<string, unknown>;
const record = (value: unknown): Data =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Data : {};

export function shouldEstimate(providerId: string, window: number, official: readonly ContextCategory[]): boolean {
  return window > 0 && official.length === 0 && providerId !== "claude-code";
}

function tokens(value: unknown): number {
  if (value == null) return 0;
  // 工具结果有时带图片 data URI 或 MCP 的 base64 data 字段；编码长度不代表视觉 token。
  if (typeof value === "string" && value.startsWith("data:") && value.slice(0, 100).includes(";base64,")) return 0;
  const text = typeof value === "string" ? value : JSON.stringify(value, function (key, part) {
    if (key === "data" && (this.type === "image" || this.type === "audio")) return undefined;
    if (typeof part === "string" && part.startsWith("data:") && part.slice(0, 100).includes(";base64,")) return undefined;
    return part;
  });
  return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}

function inputTokens(input: unknown) {
  let user = 0;
  let attachments = 0;
  for (const part of Array.isArray(input) ? input : []) {
    const block = record(part);
    if (block.type === "text") user += tokens(block.text);
    // 图片编码和二进制文件大小都不能直接换算为模型 token。
    if (block.type === "image" || block.type === "localImage") attachments += 256;
    if (block.type === "localFile") attachments += tokens(block.name ?? block.path);
  }
  return { user, attachments };
}

const MESSAGE_LABELS = {
  user: "User messages", assistant: "Assistant messages", calls: "Tool calls", results: "Tool results", attachments: "Attachments",
};

/** 只读取终态 item 的模型内容；不计 UI 展示元数据、流式增量或子 agent 内部活动。 */
function toolParts(item: Data): [unknown, unknown] {
  switch (item.type) {
    case "commandExecution": return [item.command, item.aggregatedOutput];
    case "fileChange": return [item.changes, item.error];
    case "toolCall": return [[item.tool, item.arguments], item.result ?? item.error];
    case "webSearch": return [item.queries, item.resultText];
    case "webFetch": return [item.url, item.resultText];
    case "fileRead": return [item.cmd ?? item.path, null];
    case "search": return [item.cmd ?? item.query, null];
    case "imageView": return [item.path, null];
    default: return [null, null];
  }
}

export function isContextBoundary(event: EstimateEvent): boolean {
  if (event.type === "thread/compacted" || event.type === "thread/context/cleared") return true;
  if (event.type !== "item/completed") return false;
  const item = record(record(event.data).item);
  return item.type === "contextCompaction" && !item.parentToolCallId;
}

export function messageEstimates(newestFirst: readonly EstimateEvent[]): ContextEntry[] {
  const totals = { user: 0, assistant: 0, calls: 0, results: 0, attachments: 0 };
  const accepted = new Map<string, string | undefined>();
  const countedTurns = new Set<string>();
  const echoedInputs: { turnId?: string; input: unknown }[] = [];
  const seen = new Set<string>();
  const addInput = (input: unknown) => {
    const { user, attachments } = inputTokens(input);
    totals.user += user;
    totals.attachments += attachments;
  };
  for (const event of newestFirst) {
    if (isContextBoundary(event)) break;
    const data = record(event.data);
    const turnId = event.scope?.turnId;
    if (event.type === "turn/input/accepted" && typeof data.clientRequestId === "string") {
      accepted.set(data.clientRequestId, turnId);
    }
    if (event.type === "client/turn/requested" && typeof data.requestId === "string" && accepted.has(data.requestId)) {
      const acceptedTurn = accepted.get(data.requestId);
      if (acceptedTurn) countedTurns.add(acceptedTurn);
      accepted.delete(data.requestId);
      if (data.initiator === "user") addInput(data.input);
    }
    if (event.type !== "item/completed") continue;
    const item = record(data.item);
    if (item.parentToolCallId || typeof item.id !== "string") continue;
    const key = JSON.stringify([turnId, item.type, item.id]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (item.type === "userMessage") echoedInputs.push({ turnId, input: item.content });
    if (item.type === "agentMessage" || item.type === "plan") totals.assistant += tokens(item.text);
    const [call, result] = toolParts(item);
    totals.calls += tokens(call);
    totals.results += tokens(result);
  }
  for (const echo of echoedInputs) {
    if (!echo.turnId || !countedTurns.has(echo.turnId)) addInput(echo.input);
  }
  return (Object.keys(totals) as (keyof typeof totals)[])
    .filter((id) => totals[id] > 0)
    .map((id) => ({ id, label: MESSAGE_LABELS[id], tokens: totals[id] }));
}

function fileEstimates(providerId: string, files: readonly ContextFile[]): ContextEntry[] {
  const names = providerId === "codex" ? ["AGENTS.override.md", "AGENTS.md"] :
    providerId === "acp-antigravity-acp" ? ["GEMINI.md"] : [];
  const entries: ContextEntry[] = [];
  for (const level of ["global", "project"] as const) {
    const candidates = files.filter(file => file.level === level && (file.sizeBytes ?? 0) > 0);
    const match = names.map(name => candidates.find(file => file.name === name)).find(Boolean);
    if (match) entries.push({ id: level, label: `${level === "global" ? "Global" : "Project"} · ${match.name}`, tokens: Math.ceil(match.sizeBytes! / 4) });
  }
  return entries;
}

export function estimateCategories(used: number, window: number, messages: readonly ContextEntry[], providerId: string, files: readonly ContextFile[]): ContextCategory[] {
  const categories: ContextCategory[] = [
    { id: "messages", label: "Messages", kind: "used", tokens: 0, entries: messages.map(entry => ({ ...entry })) },
    { id: "files", label: "Context files", kind: "used", tokens: 0, entries: fileEstimates(providerId, files) },
  ];
  const raw = categories.flatMap(category => category.entries).reduce((sum, entry) => sum + entry.tokens, 0);
  // 按累计份额取整再作差，最后一项恰好用完预算，同时保持父子项的整数和。
  let cumulative = 0;
  let allocated = 0;
  for (const category of categories) {
    for (const entry of category.entries) {
      cumulative += entry.tokens;
      const next = raw > used ? Math.round(cumulative / raw * used) : cumulative;
      entry.tokens = next - allocated;
      category.tokens += entry.tokens;
      allocated = next;
    }
  }
  categories.push(
    { id: "system", label: "System & tools (est.)", kind: "used", tokens: used - allocated, entries: [] },
    { id: "free", label: "Free space", kind: "free", tokens: Math.max(0, window - used), entries: [] },
  );
  return categories;
}
