/**
 * [INPUT]: lsof -F 机器可读输出 (文本)
 * [OUTPUT]: 对外提供 parseListeners / parseCwds / parsePsTable / isUnderRoot / mergeListeners / classifyOwnership / isStoppable / friendlyProcessName / browserUrl / parseDockerRows / parsePortLabels / parsePsEnvThreads / threadIdFromEnv: 解析监听端口、工作目录与进程树, 做工作区过滤、归属判定 (能否停止) 与显示命名
 * [POS]: lib 层的端口发现纯逻辑, 无 IO; 消费者: host.ts (在宿主机执行 lsof 后解析)、test/lsof.test.ts; 与 host.ts 的边界: 本文件只解析与过滤, 不执行命令
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */

export interface RawListener {
  pid: number;
  command: string;
  address: string;
  port: number;
}

export interface Listener {
  pid: number;
  command: string;
  port: number;
  /** 同一进程同一端口可能同时绑 IPv4/IPv6, 合并成一条 */
  addresses: string[];
  cwd: string | null;
}

/** "*:3000" / "127.0.0.1:6768" / "[::1]:5173" → { address, port } */
export function splitAddress(name: string): { address: string; port: number } | null {
  const match = /^(.*):(\d+)$/.exec(name.trim());
  if (!match) return null;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { address: match[1]!.replace(/^\[|\]$/g, ""), port };
}

/**
 * 解析 `lsof -nP -iTCP -sTCP:LISTEN -F pcn`。
 * 每行首字母是字段: p=pid、c=命令名、n=地址; 其余字段 (f 等) 忽略。
 */
export function parseListeners(output: string): RawListener[] {
  const listeners: RawListener[] = [];
  let pid: number | null = null;
  let command = "";
  for (const line of output.split("\n")) {
    const field = line[0];
    const value = line.slice(1);
    if (field === "p") {
      pid = Number(value);
      command = "";
    } else if (field === "c") {
      command = value;
    } else if (field === "n" && pid !== null && Number.isInteger(pid)) {
      // 形如 "127.0.0.1:3000->..." 的是已建立连接, LISTEN 过滤后不应出现, 防御性跳过
      if (value.includes("->")) continue;
      const parsed = splitAddress(value);
      if (parsed) listeners.push({ pid, command, ...parsed });
    }
  }
  return listeners;
}

/** 解析 `lsof -a -nP -d cwd -Fpn -p <pids>` → pid 到工作目录的映射 */
export function parseCwds(output: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid: number | null = null;
  for (const line of output.split("\n")) {
    const field = line[0];
    const value = line.slice(1);
    if (field === "p") pid = Number(value);
    else if (field === "n" && pid !== null && value.startsWith("/")) {
      cwds.set(pid, value);
    }
  }
  return cwds;
}

const trimSlash = (path: string): string =>
  path.length > 1 ? path.replace(/\/+$/, "") : path;

/** 进程工作目录落在工作区根目录内 (含根本身) 即视为归属该工作区 */
export function isUnderRoot(cwd: string | null, root: string): boolean {
  if (cwd === null) return false;
  const normalizedRoot = trimSlash(root);
  const normalizedCwd = trimSlash(cwd);
  // macOS 的 /var 与 /private/var 是同一目录
  const variants = (p: string) =>
    p.startsWith("/private/") ? [p, p.slice("/private".length)] : [p, `/private${p}`];
  return variants(normalizedCwd).some(
    (c) => c === normalizedRoot || c.startsWith(`${normalizedRoot}/`),
  );
}

export function mergeListeners(
  raw: readonly RawListener[],
  cwds: ReadonlyMap<number, string>,
): Listener[] {
  const byKey = new Map<string, Listener>();
  for (const item of raw) {
    const key = `${item.pid}:${item.port}`;
    const current = byKey.get(key);
    if (current) {
      if (!current.addresses.includes(item.address)) current.addresses.push(item.address);
      continue;
    }
    byKey.set(key, {
      pid: item.pid,
      command: item.command,
      port: item.port,
      addresses: [item.address],
      cwd: cwds.get(item.pid) ?? null,
    });
  }
  return [...byKey.values()].sort((a, b) => a.port - b.port);
}

export interface ProcessRow {
  ppid: number;
  /** ps 的 comm: 启动名或可执行文件完整路径 */
  comm: string;
}

/** 解析 `ps -A -o pid=,ppid=,comm=` → pid 到 { ppid, comm } 的进程表 */
export function parsePsTable(output: string): Map<number, ProcessRow> {
  const table = new Map<number, ProcessRow>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (match) table.set(Number(match[1]), { ppid: Number(match[2]), comm: match[3]! });
  }
  return table;
}

/** 已知会常驻并监听端口的 agent CLI; 它们自己的端口 (IDE/MCP 桥) 不是开发服务 */
const AGENT_CLIS = new Set([
  "claude", "codex", "cursor-agent", "opencode", "gemini", "amp", "pi", "droid",
  "goose", "aider", "qwen", "kimi", "crush", "copilot", "hermes",
]);

/** comm 的工具名: 路径取 basename, 版本目录布局还原工具名 */
export function toolOf(comm: string): string {
  const layout = /\/([^/]+)\/versions\/[^/]+$/.exec(comm);
  if (layout) return layout[1]!;
  return comm.split("/").pop() || comm;
}

/**
 * 端口归属 (T3 Code 的 owned 语义):
 * - agent:        进程本身就是 agent CLI → 结束它等于杀掉一个会话, 不允许
 * - agent-child:  祖先链上有 agent CLI → agent 起的开发服务, 允许停止
 * - terminal:     祖先链上先遇到 bb 进程 (终端 shell 的父进程) → 终端里起的服务, 允许停止
 * - other:        launchd 等拉起的常驻进程, 来路不明, 不允许
 */
export type Ownership =
  | { kind: "agent"; agent: string }
  | { kind: "agent-child"; agent: string }
  | { kind: "terminal" }
  | { kind: "other" };

export function classifyOwnership(
  pid: number,
  command: string,
  table: ReadonlyMap<number, ProcessRow>,
): Ownership {
  const self = table.get(pid);
  const selfTool = self ? toolOf(self.comm) : command;
  // lsof 报的版本号二进制名 (如 2.1.325) 也按 claude 处理时需要 ps 的启动名
  if (AGENT_CLIS.has(selfTool)) return { kind: "agent", agent: selfTool };
  let current = self?.ppid;
  for (let depth = 0; current && current > 1 && depth < 64; depth++) {
    const row = table.get(current);
    if (!row) break;
    const tool = toolOf(row.comm);
    if (AGENT_CLIS.has(tool)) return { kind: "agent-child", agent: tool };
    if (tool === "bb") return { kind: "terminal" };
    current = row.ppid;
  }
  return { kind: "other" };
}

export const isStoppable = (ownership: Ownership): boolean =>
  ownership.kind === "agent-child" || ownership.kind === "terminal";

const VERSION_LIKE = /^\d+(?:\.\d+)+/;

/**
 * 进程显示名。lsof 报的是解析后的二进制名, 按版本号命名的二进制
 * (如 Claude Code 的 ~/.local/share/claude/versions/2.1.325) 只显示 "2.1.325";
 * ps 的 comm 则是启动名 ("claude") 或完整路径。两者合并成 "claude 2.1.325"。
 */
export function friendlyProcessName(command: string, executable: string | null): string {
  if (!executable) return command;
  const layout = /\/([^/]+)\/versions\/([^/]+)$/.exec(executable);
  if (layout) return `${layout[1]} ${layout[2]}`;
  const base = executable.split("/").pop() || command;
  if (VERSION_LIKE.test(command) && base !== command) return `${base} ${command}`;
  return base;
}

/** 用于浏览器打开的地址: 只绑 IPv6 回环时用 [::1], 其余都走 localhost */
export function browserUrl(listener: Pick<Listener, "addresses" | "port">): string {
  const onlyV6 = listener.addresses.every((a) => a === "::1");
  return onlyV6 ? `http://[::1]:${listener.port}` : `http://localhost:${listener.port}`;
}

// ---------------------------------------------------------------------------
// 以下三项的思路来自 Worktree Ports 插件 (To Infinity Labs, MIT): docker compose 端口归属与 ports.json 命名
// ---------------------------------------------------------------------------

export interface DockerRow {
  name: string;
  /** compose 项目的工作目录; 用它判断容器是否属于本工作区 */
  workingDir: string;
  service: string | null;
  ports: { port: number; address: string }[];
}

/** `0.0.0.0:21785->6379/tcp, [::]:21785->6379/tcp` → 只取发布到宿主机的端口, IPv4/IPv6 合并 */
export function parseDockerPorts(value: string): { port: number; address: string }[] {
  const seen = new Map<number, string>();
  for (const entry of value.split(",")) {
    const arrow = entry.indexOf("->");
    if (arrow === -1) continue;
    const parsed = splitAddress(entry.slice(0, arrow).trim());
    if (!parsed) continue;
    if (!seen.has(parsed.port) || parsed.address.includes(".")) seen.set(parsed.port, parsed.address);
  }
  return [...seen].map(([port, address]) => ({ port, address }));
}

/** `docker ps --format` 的制表符分隔行: 名称 \t 端口 \t compose 工作目录 \t compose 服务名 */
export function parseDockerRows(output: string): DockerRow[] {
  const rows: DockerRow[] = [];
  for (const line of output.split("\n")) {
    const [name, ports, workingDir, service] = line.split("\t");
    if (!name || !workingDir || workingDir.trim() === "") continue;
    rows.push({
      name: name.trim(),
      workingDir: workingDir.trim(),
      service: service && service.trim() !== "" ? service.trim() : null,
      ports: parseDockerPorts(ports ?? ""),
    });
  }
  return rows;
}

export interface PortLabel {
  label: string;
  scheme: "http" | "https" | null;
}

/** 工作区里的 .bb/ports.json: { "ports": [{ "port": 5173, "label": "Web", "scheme": "http" }] }; 坏文件不命名任何端口 */
export function parsePortLabels(content: string): Map<number, PortLabel> {
  const labels = new Map<number, PortLabel>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return labels;
  }
  const entries = (parsed as { ports?: unknown } | null)?.ports;
  if (!Array.isArray(entries)) return labels;
  for (const entry of entries) {
    const { port, label, scheme } = (entry ?? {}) as { port?: unknown; label?: unknown; scheme?: unknown };
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    if (typeof label !== "string" || label.trim() === "") continue;
    labels.set(port, { label: label.trim().slice(0, 60), scheme: scheme === "https" || scheme === "http" ? scheme : null });
  }
  return labels;
}

// ---------------------------------------------------------------------------
// 线程归属: 思路来自 Hotspot 插件 (Roger Serra, MIT)。bb 给它启动的每个 agent 导出 BB_THREAD_ID,
// 子进程继承环境, 所以 agent 起的服务带着所属线程的 id; 共用一个工作区的多个线程由此区分。
// ---------------------------------------------------------------------------

const ENV_THREAD = /(?:^|[\s\0])BB_THREAD_ID=(thr_[a-z0-9]{8,})(?![a-z0-9])/;

/** 从一段环境文本 (ps -E 的行尾, 或 /proc/<pid>/environ) 里取线程 id */
export function threadIdFromEnv(text: string): string | null {
  return ENV_THREAD.exec(text)?.[1] ?? null;
}

/** 解析 `ps -E -ww -o pid=,command= -p <pids>` (macOS): 每行 pid + 命令行 + 环境 → pid 到线程 id */
export function parsePsEnvThreads(output: string): Map<number, string> {
  const threads = new Map<number, string>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const threadId = threadIdFromEnv(match[2]!);
    if (threadId) threads.set(Number(match[1]), threadId);
  }
  return threads;
}
