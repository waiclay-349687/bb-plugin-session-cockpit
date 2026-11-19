/**
 * [INPUT]: BB 逆序线程事件、宿主扫描的上下文文件元数据与 provider 的窗口用量
 * [OUTPUT]: 从 BB 事件提取文件读取和消息占用，关联宿主文件清单并将兜底分类分配到 provider 用量预算
 * [POS]: 为 server.ts 计算窗口读取统计与兜底分类；usage.ts 处理官方用量
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import type { ContextCategory, ContextEntry } from "./usage";
import { contextFileKeys, contextPathKey, LEVEL_LABELS, relativePath, type ContextFile, type ContextFileStats, type LoadedEntry } from "./context-files.ts";

export const ESTIMATE_EVENTS = [
  "client/turn/requested", "turn/input/accepted", "item/completed", "thread/compacted", "thread/context/cleared",
] as const;

export type EstimateEvent = { type: string; data: unknown; scope?: { turnId?: string; kind: string } };
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

const READ_TOOLS = new Set(["read", "readfile", "viewfile", "readtextfile"]);
const PATH_FIELDS = ["Path", "path", "file_path", "filePath", "target_file", "AbsolutePath"];

/** 只接受简单的单文件 cat。管道、重定向、通配、变量和复合命令都不作为已读证据。 */
function simpleFileCommand(command: unknown): string | null {
  if (typeof command !== "string") return null;
  // BB 将 Codex 的 shell 调用渲染成 /bin/zsh -c '…'；仅解开这一层，再走同一条严格的 cat 规则。
  const text = command.trim();
  const wrapped = /^\/bin\/(?:zsh|bash|sh) -(?:l)?c '([^']+)'$/.exec(text);
  const match = /^(?:\/bin\/)?cat[ \t]+(?:--[ \t]+)?(?:"([^"$`\\]+)"|'([^']+)'|([\w./-]+))$/.exec(wrapped?.[1] ?? text);
  const path = match?.[1] ?? match?.[2] ?? match?.[3];
  return path && !path.startsWith("-") ? path : null;
}

function itemReadPath(item: Data, root?: string | null): string | null {
  if (item.status !== "completed" || item.error || record(item.result).isError === true) return null;
  let path: unknown;
  if (item.type === "fileRead") {
    path = item.path || simpleFileCommand(item.cmd);
  } else if (item.type === "toolCall" && typeof item.tool === "string") {
    const tool = item.tool.split(/__|[:/]/).at(-1)!.replace(/[_-]/g, "").toLowerCase();
    if (!READ_TOOLS.has(tool)) return null;
    const args = record(item.arguments);
    path = PATH_FIELDS.map(key => args[key]).find(value => typeof value === "string" && value.length > 0);
  } else if (item.type === "commandExecution" && item.exitCode === 0) {
    path = simpleFileCommand(item.command);
    // 相对 shell 路径以实际 cwd 为准。
    if (typeof item.cwd === "string" && item.cwd.startsWith("/")) root = item.cwd;
  }
  return typeof path === "string" ? contextPathKey(path, root) : null;
}

export function observedFilePath(event: EstimateEvent, root?: string | null): string | null {
  if (event.type !== "item/completed") return null;
  const item = record(record(event.data).item);
  return item.parentToolCallId ? null : itemReadPath(item, root);
}

export function isContextBoundary(event: EstimateEvent): boolean {
  if (event.type === "thread/compacted" || event.type === "thread/context/cleared") return true;
  if (event.type !== "item/completed") return false;
  const item = record(record(event.data).item);
  return item.type === "contextCompaction" && !item.parentToolCallId;
}

export function messageActivity(newestFirst: readonly EstimateEvent[], root?: string | null) {
  const fileResults = new Map<string, number>();
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
    const resultTokens = tokens(result);
    const path = itemReadPath(item, root);
    if (path && resultTokens) fileResults.set(path, (fileResults.get(path) ?? 0) + resultTokens);
    totals.results += resultTokens;
  }
  for (const echo of echoedInputs) {
    if (!echo.turnId || !countedTurns.has(echo.turnId)) addInput(echo.input);
  }
  const entries = (Object.keys(totals) as (keyof typeof totals)[])
    .filter((id) => totals[id] > 0)
    .map((id) => ({ id, label: MESSAGE_LABELS[id], tokens: totals[id] }));
  return { entries, fileResults };
}

export function messageEstimates(activity: ReturnType<typeof messageActivity>, accountedPaths: ReadonlySet<string> = new Set()): ContextEntry[] {
  let overlapping = 0;
  for (const [path, count] of activity.fileResults) if (accountedPaths.has(path)) overlapping += count;
  return activity.entries.map(entry => entry.id === "results" ? { ...entry, tokens: entry.tokens - overlapping } : entry)
    .filter(entry => entry.tokens > 0);
}

export function hasStartupEstimate(providerId: string): boolean {
  return providerId === "codex" || providerId === "acp-antigravity-acp";
}

function startupFiles(providerId: string, files: readonly ContextFile[]): Set<ContextFile> {
  const names = providerId === "codex" ? ["AGENTS.override.md", "AGENTS.md"] :
    providerId === "acp-antigravity-acp" ? ["GEMINI.md"] : [];
  const selected = new Set<ContextFile>();
  for (const level of ["global", "project"] as const) {
    const match = names.map(name => files.find(file => file.level === level && file.name === name)).find(Boolean);
    if (match) selected.add(match);
  }
  return selected;
}

/** 工作区统计只计宿主扫描清单里的文件。官方 token 优先，观测读取优先于启动推断。 */
export function contextFileUsage(files: readonly ContextFile[], reads: ReadonlySet<string>, official: readonly LoadedEntry[] | null, providerId: string) {
  const startup = official === null ? startupFiles(providerId, files) : new Set<ContextFile>();
  const exact = new Map(official?.map(entry => [contextPathKey(entry.label), entry.tokens]));
  const accountedPaths = new Set<string>();
  const stats: ContextFileStats = {
    total: files.length,
    entries: [],
    basis: official !== null ? "official" : hasStartupEstimate(providerId) ? "estimated" : "observed",
  };
  const aliases = new Map<string, ContextFile[]>();
  for (const file of files) {
    const key = contextPathKey(file.realPath ?? file.path);
    if (!key) continue;
    const group = aliases.get(key);
    if (group) group.push(file);
    else aliases.set(key, [file]);
  }
  for (const group of aliases.values()) {
    const keys = group.flatMap(contextFileKeys);
    const officialTokens = keys.map(key => exact.get(key)).find(value => value !== undefined);
    const read = group.find(file => contextFileKeys(file).some(key => reads.has(key)));
    const inferred = group.find(file => startup.has(file));
    const source = officialTokens !== undefined ? "official" : read ? "read" : inferred ? "startup" : null;
    if (!source) continue;
    const file = read ?? inferred ?? group[0]!;
    for (const key of keys) accountedPaths.add(key);
    stats.entries.push({
      path: file.path,
      label: file.level === "modules" || file.dir !== "" && file.level === "local"
        ? relativePath(file) : `${LEVEL_LABELS[file.level]} · ${file.name}`,
      tokens: officialTokens ?? Math.ceil((file.sizeBytes ?? 0) / 4),
      source,
    });
  }
  return { stats, accountedPaths };
}

export function estimateCategories(used: number, window: number, messages: readonly ContextEntry[], files: readonly ContextEntry[]): ContextCategory[] {
  const categories: ContextCategory[] = [
    { id: "messages", label: "Messages", kind: "used", tokens: 0, entries: messages.map(entry => ({ ...entry })) },
    { id: "files", label: "Context files", kind: "used", tokens: 0, entries: files.map(entry => ({ ...entry })) },
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

type SequencedEvent = EstimateEvent & { seq: number };
export interface WindowActivity {
  seq: number;
  paths: ReadonlySet<string>;
  messages: ReturnType<typeof messageActivity>;
}

/** 消息估算有历史上限；已读文件追到最近压缩边界，后续只累计新增事件。 */
export async function scanWindowActivity(
  head: number,
  pageSize: number,
  list: (before?: number) => Promise<SequencedEvent[]>,
  root: string | null,
  messageLimit: number,
  previous?: WindowActivity,
): Promise<WindowActivity> {
  if (previous?.seq === head) return previous;
  const cached = previous && previous.seq < head ? previous : undefined;
  let covered = false;
  let before: number | undefined;
  const paths = new Set<string>();
  const messages: EstimateEvent[] = [];
  for (;;) {
    const page = await list(before);
    for (const event of page) {
      if (event.seq > head) continue;
      if (isContextBoundary(event)) return { seq: head, paths, messages: messageActivity(messages, root) };
      if (!covered && cached && event.seq <= cached.seq) {
        for (const path of cached.paths) paths.add(path);
        covered = true;
      }
      if (!covered) {
        const path = observedFilePath(event, root);
        if (path) paths.add(path);
      }
      if (messages.length < messageLimit) messages.push(event);
    }
    if (page.length < pageSize || (covered && messages.length >= messageLimit)) break;
    before = page.at(-1)!.seq;
  }
  return { seq: head, paths, messages: messageActivity(messages, root) };
}
