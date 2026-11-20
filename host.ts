/**
 * [INPUT]: 依赖宿主机的 lsof / ps / docker (可选) / git (可选) 命令、工作区的 .bb/ports.json (可选) 与 Node child_process/fetch/fs; 依赖 lib/lsof.ts 的解析与归属判定、lib/context-files.ts 的层级判定与导入解析
 * [OUTPUT]: 对外提供宿主入口 (default export): listListeners 列出工作区内进程监听的端口及其归属, stopListener 结束其中可停止的一个, discoverContextFiles 与 listContextFiles 列出工作区的上下文文件 (层级、有无改动、导入、各层级字节数及符号链接目标; 只读); listBranches (只读 git: 本地分支清单, 标出当前 / 默认 / 在别的 worktree 检出)
 * [POS]: 插件的 bb.host 入口, 在线程所在机器上以完整信任运行; 消费者: server.ts 的 servers/stopServer/contextFiles RPC; 与 server.ts 的边界: 只做本机进程与文件层面的事, 不认识线程与项目
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { execFile } from "node:child_process";
import { readFile, readdir, readlink, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract, type ListenerInfo } from "./contract.ts";
import { buildBranches, defaultBranchName, parseWorktreeList, type BranchEntry } from "./lib/environment.ts";
import {
  CONTEXT_LEVELS,
  IMPORT_LEVELS,
  candidatePaths,
  changedMatcher,
  classifyPath,
  classifyRelative,
  compareRelative,
  listedDirs,
  parseGitStatus,
  resolveImports,
  type ContextFile,
  type GitStatus,
} from "./lib/context-files.ts";
import {
  browserUrl,
  classifyOwnership,
  friendlyProcessName,
  isStoppable,
  isUnderRoot,
  mergeListeners,
  parseCwds,
  parseListeners,
  parseDockerRows,
  parsePortLabels,
  parsePsEnvThreads,
  parsePsTable,
  threadIdFromEnv,
  type Listener,
  type PortLabel,
  type ProcessRow,
} from "./lib/lsof.ts";

const COMMAND_TIMEOUT_MS = 15_000; // docker stop 默认等容器 10 秒
const PROBE_TIMEOUT_MS = 800;
/** 多个窗格同时看同一工作区时, 5 秒内复用同一次扫描 */
const SCAN_CACHE_MS = 5000;
/** 同一 pid:端口的 HTTP 探测结果缓存 60 秒 */
const PROBE_CACHE_MS = 60_000;

/** 上下文文件: 同一工作区 15 秒内复用同一次发现 ("有改动"要显得新, 所以不能更久) */
const CONTEXT_CACHE_MS = 15_000;
/** 找导入时单个文件最多读 256 KB, 更大的不读 */
const IMPORT_READ_LIMIT = 256 * 1024;
/** 不是 git 仓库时的有界目录遍历 */
const WALK_MAX_DEPTH = 6;
const WALK_MAX_DIRS = 2000;
const WALK_SKIP = new Set(["node_modules", "dist", "build", "vendor", "target"]);
const WORKSPACE_PATHSPECS = ["*CLAUDE.md", "*AGENTS.md", "*GEMINI.md", "*CLAUDE.local.md"];
/** 一个列出的目录 (规则、自动记忆) 最多取这么多个文件 */
const LISTED_DIR_LIMIT = 500;

interface ContextFilesResult {
  isGitRepo: boolean;
  files: ContextFile[];
}

const scanCache = new Map<string, { at: number; value: Promise<ListenerInfo[]> }>();
const contextCache = new Map<string, { at: number; value: Promise<ContextFilesResult> }>();
const probeCache = new Map<string, { at: number; http: boolean }>();

class LsofMissingError extends Error {}

function run(file: string, args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, signal },
      (error, stdout) => {
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new LsofMissingError(`${file} is not installed on this machine`));
          return;
        }
        // lsof 在部分进程无权限读取时以 1 退出, 但 stdout 仍是有效结果
        if (error && stdout.length === 0 && (error as { code?: unknown }).code !== 1) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

interface ClassifiedListener extends Listener {
  label: string;
  owner: ListenerInfo["owner"];
  ownerAgent: string | null;
  stoppable: boolean;
  container: string | null;
  name: string | null;
  scheme: "http" | "https" | null;
  threadId: string | null;
}

/** pid → 启动它的 bb 线程。环境里可能有密钥: 只在内存里匹配 BB_THREAD_ID, 不记录不返回 */
async function ownerThreads(pids: number[], signal: AbortSignal): Promise<Map<number, string>> {
  if (pids.length === 0) return new Map();
  if (process.platform === "linux") {
    const threads = new Map<number, string>();
    await Promise.all(
      pids.map(async (pid) => {
        const id = threadIdFromEnv(await readFile(`/proc/${pid}/environ`, "utf8").catch(() => ""));
        if (id) threads.set(pid, id);
      }),
    );
    return threads;
  }
  return parsePsEnvThreads(await run("ps", ["-E", "-ww", "-o", "pid=,command=", "-p", pids.join(",")], signal).catch(() => ""));
}

/** pid → 工作目录。Linux 直接读 /proc (更快更准), macOS 用第二次 lsof */
async function workingDirectories(pids: number[], signal: AbortSignal): Promise<Map<number, string>> {
  if (process.platform === "linux") {
    const cwds = new Map<number, string>();
    await Promise.all(
      pids.map(async (pid) => {
        try {
          cwds.set(pid, await readlink(`/proc/${pid}/cwd`));
        } catch {
          // 进程已退出或属于其他用户
        }
      }),
    );
    return cwds;
  }
  return parseCwds(await run("lsof", ["-a", "-nP", "-d", "cwd", "-F", "pn", "-p", pids.join(",")], signal));
}

/** 工作区自己给端口起的名字 */
async function portLabels(root: string): Promise<Map<number, PortLabel>> {
  try {
    return parsePortLabels(await readFile(join(root, ".bb", "ports.json"), "utf8"));
  } catch {
    return new Map();
  }
}

/** docker compose 容器发布的端口: 进程属于 docker, 工作目录不在工作区, 只能靠 compose 的工作目录标签归属 */
async function dockerListeners(root: string, signal: AbortSignal): Promise<ClassifiedListener[]> {
  let output: string;
  try {
    output = await run(
      "docker",
      ["ps", "--format", '{{.Names}}\t{{.Ports}}\t{{.Label "com.docker.compose.project.working_dir"}}\t{{.Label "com.docker.compose.service"}}'],
      signal,
    );
  } catch {
    return []; // 没装 docker 或守护进程没开: 进程扫描的结果照常
  }
  return parseDockerRows(output)
    .filter((row) => isUnderRoot(row.workingDir, root))
    .flatMap((row) =>
      row.ports.map((published) => ({
        pid: 0,
        command: "docker",
        port: published.port,
        addresses: [published.address],
        cwd: row.workingDir,
        label: row.service ?? row.name,
        owner: "docker" as const,
        ownerAgent: null,
        threadId: null,
        stoppable: true,
        container: row.name,
        name: null,
        scheme: null,
      })),
    );
}

/** 列出工作区内的监听 (进程 + docker compose), 按进程树判定归属, 套上 ports.json 的命名 */
async function scan(root: string, signal: AbortSignal): Promise<ClassifiedListener[]> {
  const [lsofOutput, docker, labels] = await Promise.all([
    run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"], signal),
    dockerListeners(root, signal),
    portLabels(root),
  ]);
  const raw = parseListeners(lsofOutput);
  let processes: ClassifiedListener[] = [];
  if (raw.length > 0) {
    const cwds = await workingDirectories([...new Set(raw.map((item) => item.pid))], signal);
    const listeners = mergeListeners(raw, cwds).filter((l) => isUnderRoot(l.cwd, root));
    if (listeners.length > 0) {
      // 判定归属要看祖先链, 所以取全量进程表; ps 失败时一律按 other 处理 (不可停止)
      const table: Map<number, ProcessRow> = parsePsTable(await run("ps", ["-A", "-o", "pid=,ppid=,comm="], signal).catch(() => ""));
      const threads = await ownerThreads(listeners.map((l) => l.pid), signal);
      processes = listeners.map((listener) => {
        const ownership = classifyOwnership(listener.pid, listener.command, table);
        return {
          ...listener,
          label: friendlyProcessName(listener.command, table.get(listener.pid)?.comm ?? null),
          owner: ownership.kind,
          ownerAgent: ownership.kind === "agent" || ownership.kind === "agent-child" ? ownership.agent : null,
          stoppable: isStoppable(ownership),
          threadId: threads.get(listener.pid) ?? null,
          container: null,
          name: null,
          scheme: null,
        };
      });
    }
  }
  // 同一端口既被进程扫到又被 docker 扫到时, 以进程那条为准
  const seen = new Set(processes.map((l) => l.port));
  return [...processes, ...docker.filter((l) => !seen.has(l.port))]
    .map((l) => ({ ...l, name: labels.get(l.port)?.label ?? null, scheme: labels.get(l.port)?.scheme ?? null }))
    .sort((a, b) => a.port - b.port);
}

/** HEAD 探测: 任何 HTTP 响应 (含 404/重定向) 都算网页服务; 结果按 pid:端口缓存 */
async function probe(listener: Listener): Promise<boolean> {
  const key = `${listener.pid}:${listener.port}`;
  const cached = probeCache.get(key);
  if (cached && Date.now() - cached.at < PROBE_CACHE_MS) return cached.http;
  const host = listener.addresses.every((a) => a === "::1") ? "[::1]" : "127.0.0.1";
  let http = false;
  try {
    await fetch(`http://${host}:${listener.port}/`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    http = true;
  } catch {
    http = false;
  }
  probeCache.set(key, { at: Date.now(), http });
  return http;
}

/** 扫描 + 探测; agent 会话自己的端口 (IDE/MCP 桥) 不探测 */
async function describe(root: string, signal: AbortSignal): Promise<ListenerInfo[]> {
  const listeners = await scan(root, signal);
  return Promise.all(
    listeners.map(async (listener) => ({
      ...listener,
      url: listener.scheme === "https" ? browserUrl(listener).replace(/^http:/, "https:") : browserUrl(listener),
      http: listener.owner === "agent" ? null : await probe(listener),
    })),
  );
}

// ---------------------------------------------------------------------------
// 上下文文件 (只读: git ls-files / git status --porcelain / stat / readdir / readFile)
// ---------------------------------------------------------------------------

const isFile = (path: string): Promise<boolean> => stat(path).then((info) => info.isFile(), () => false);

/** 工作区根相对仓库顶层的前缀 (如 "packages/app/"): git status 的路径相对仓库顶层, ls-files 的相对当前目录, 要靠它对齐 */
async function repoPrefix(root: string): Promise<string> {
  let dir = root;
  for (let depth = 0; depth < 40; depth++) {
    if (await stat(join(dir, ".git")).then(() => true, () => false)) {
      return dir === root ? "" : `${root.slice(dir.length).replace(/^\/+/, "")}/`;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "";
}

/** 目录下直接放着的 *.md (MEMORY.md 排最前, 其余按名字); 目录不存在返回空 */
async function listMarkdown(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const sorted = names
    .filter((name) => name.toLowerCase().endsWith(".md"))
    .sort((a, b) => Number(b === "MEMORY.md") - Number(a === "MEMORY.md") || a.localeCompare(b))
    .slice(0, LISTED_DIR_LIMIT);
  const kept = await Promise.all(sorted.map(async (name) => ((await isFile(join(dir, name))) ? join(dir, name) : null)));
  return kept.filter((path): path is string => path !== null);
}

/** 不是 git 仓库时找子目录里的上下文文件: 广度优先, 限深度与目录数, 跳过点目录与依赖 / 产物目录 */
async function walkWorkspace(root: string): Promise<string[]> {
  const found: string[] = [];
  let level = [""];
  let visited = 0;
  for (let depth = 0; depth <= WALK_MAX_DEPTH && level.length > 0; depth++) {
    const next: string[] = [];
    for (const rel of level) {
      if (++visited > WALK_MAX_DIRS) return found;
      const entries = await readdir(join(root, rel), { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
          if (!entry.name.startsWith(".") && !WALK_SKIP.has(entry.name)) next.push(child);
        } else if ((entry.isFile() || entry.isSymbolicLink()) && rel !== "" && classifyRelative(child) !== null) {
          found.push(child);
        }
      }
    }
    level = next;
  }
  return found;
}

/**
 * 子目录里的上下文文件 (模块、子目录里的本地私有) 与"有改动"。git 仓库里用 ls-files, 天然遵守 .gitignore、不进 node_modules;
 * 不是仓库 (或没装 git) 时退回有界遍历, 此时没有"有改动"一说。
 */
async function workspaceFiles(root: string, signal: AbortSignal): Promise<{ isGitRepo: boolean; paths: string[]; status: GitStatus }> {
  const none: GitStatus = { changed: [], deleted: [] };
  let listed: string;
  try {
    // 路径规格只是让 git 少吐无关路径 (大仓库的全量清单会撑爆缓冲区); 层级仍由 classifyRelative 按文件名精确判定
    listed = await run("git", ["-C", root, "ls-files", "-co", "--exclude-standard", "-z", "--", ...WORKSPACE_PATHSPECS], signal);
  } catch {
    return { isGitRepo: false, paths: (await walkWorkspace(root)).sort(compareRelative), status: none };
  }
  const [output, prefix] = await Promise.all([
    run("git", ["-C", root, "status", "--porcelain", "-z", "--", "."], signal).catch(() => ""),
    repoPrefix(root),
  ]);
  const status = parseGitStatus(output, prefix);
  const deleted = new Set(status.deleted);
  const paths = listed
    .split("\0")
    .filter((rel) => rel.includes("/") && !deleted.has(rel) && classifyRelative(rel) !== null)
    .sort(compareRelative);
  return { isGitRepo: true, paths, status };
}

/** 所有层级只需元数据。仅导入层级读取体积受限的说明文件。 */
async function contextMetadata(path: string, home: string, readImports: boolean) {
  const [info, resolved] = await Promise.all([stat(path).catch(() => null), realpath(path).catch(() => path)]);
  if (!info?.isFile()) return null;
  const metadata = { sizeBytes: info.size, ...(resolved !== path && { realPath: resolved }) };
  const imports = readImports && info.size <= IMPORT_READ_LIMIT && !/\.jsonl$/i.test(resolved)
    ? await readFile(resolved, "utf8").then(text => resolveImports(text, path, home, isFile)).catch(() => [])
    : [];
  return { ...metadata, imports };
}

export async function discoverContextFiles(rawRoot: string, signal: AbortSignal, home = homedir()): Promise<ContextFilesResult> {
  const root = rawRoot.length > 1 ? rawRoot.replace(/\/+$/, "") : rawRoot;
  const [fixed, listed, workspace] = await Promise.all([
    Promise.all(candidatePaths(root, home).map(async (path) => ((await isFile(path)) ? path : null))),
    Promise.all(listedDirs(root, home).map(listMarkdown)),
    workspaceFiles(root, signal),
  ]);
  const paths = new Set([
    ...fixed.filter((path): path is string => path !== null),
    ...listed.flat(),
    ...workspace.paths.map((rel) => join(root, rel)),
  ]);
  const isChanged = changedMatcher(workspace.status);
  const inside = `${root === "/" ? "" : root}/`;
  const files = await Promise.all(
    [...paths].map(async (path): Promise<ContextFile | null> => {
      const kind = classifyPath(path, { root, home });
      if (!kind) return null;
      const metadata = await contextMetadata(path, home, IMPORT_LEVELS.includes(kind.level));
      if (!metadata) return null;
      return {
        path,
        ...kind,
        changed: workspace.isGitRepo && path.startsWith(inside) && isChanged(path.slice(inside.length)),
        ...metadata,
      };
    }),
  );
  return {
    isGitRepo: workspace.isGitRepo,
    // 稳定排序: 层级顺序在前, 层级内保持发现时的顺序 (固定位置按清单、目录按名字、子目录按路径)
    files: files
      .filter((file): file is ContextFile => file !== null)
      .sort((a, b) => CONTEXT_LEVELS.indexOf(a.level) - CONTEXT_LEVELS.indexOf(b.level)),
  };
}

/** 分支浮层最多列多少个本地分支（按最近提交排） */
const BRANCH_LIMIT = 200;

/**
 * 本地分支清单（只读）：当前分支、默认分支、在别的 worktree 里检出的分支各自标出。
 * 不是 git 仓库、或任何一步 git 失败时返回空清单，不抛。
 */
async function listBranches(root: string, signal: AbortSignal): Promise<{ isGitRepo: boolean; branches: BranchEntry[]; truncated: boolean }> {
  const git = (args: string[]) => run("git", ["-C", root, ...args], signal);
  try {
    await git(["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { isGitRepo: false, branches: [], truncated: false };
  }
  // symbolic-ref 在游离 HEAD 时以 1 退出、没有输出 (run 把它当成空串), 远端没有 HEAD 时同理
  const [refsOut, current, worktreesOut, originHead] = await Promise.all([
    git(["for-each-ref", "--sort=-committerdate", `--count=${BRANCH_LIMIT + 1}`, "--format=%(refname:short)", "refs/heads"]).catch(() => ""),
    git(["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => ""),
    git(["worktree", "list", "--porcelain"]).catch(() => ""),
    git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).catch(() => ""),
  ]);
  const refs = refsOut.split("\n").map((line) => line.trim()).filter(Boolean);
  const truncated = refs.length > BRANCH_LIMIT;
  const kept = refs.slice(0, BRANCH_LIMIT);
  const head = current.trim() || null;
  // 当前分支不在最近 N 个里时也要列出来
  if (head && !kept.includes(head)) kept.unshift(head);
  return {
    isGitRepo: true,
    branches: buildBranches({ refs: kept, current: head, defaultBranch: defaultBranchName(originHead, kept), worktrees: parseWorktreeList(worktreesOut), root }),
    truncated,
  };
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    listListeners: async ({ root }, context) => {
      if (process.platform === "win32") {
        return { supported: false as const, reason: "Server discovery needs lsof (macOS or Linux)." };
      }
      try {
        const cached = scanCache.get(root);
        let pending: Promise<ListenerInfo[]>;
        if (cached && Date.now() - cached.at < SCAN_CACHE_MS) {
          pending = cached.value;
        } else {
          // 共享的扫描不绑定单次调用的 signal, 否则第一个调用方取消会让其他窗格一起失败
          pending = describe(root, context.lifecycle.signal);
          scanCache.set(root, { at: Date.now(), value: pending });
          pending.catch(() => scanCache.delete(root));
        }
        return { supported: true as const, listeners: await pending };
      } catch (error) {
        if (error instanceof LsofMissingError) {
          return { supported: false as const, reason: error.message };
        }
        throw error;
      }
    },
    listContextFiles: async ({ root }, context) => {
      const cached = contextCache.get(root);
      if (cached && Date.now() - cached.at < CONTEXT_CACHE_MS) return cached.value;
      // 共享的发现不绑定单次调用的 signal (理由同 listListeners); 任何错误都落成空列表, 不抛
      const value = discoverContextFiles(root, context.lifecycle.signal).catch(() => ({ isGitRepo: false, files: [] }));
      contextCache.set(root, { at: Date.now(), value });
      return value;
    },
    listBranches: ({ root }, context) => listBranches(root, context.lifecycle.signal),
    stopListener: async ({ root, pid, port }, context) => {
      // 结束进程前重新扫描并重新判定归属: 只结束"此刻仍在本工作区内监听该端口、且由 agent 或 bb 终端启动"的进程,
      // 防止 pid 复用误杀, 也防止绕过前端直接调用时杀掉 agent 会话或常驻服务
      const current = await scan(root, context.signal);
      const target = current.find((l) => l.pid === pid && l.port === port);
      if (!target) {
        return { stopped: false, message: `No process in this workspace is listening on port ${port} with pid ${pid}.` };
      }
      if (!target.stoppable) {
        const reason =
          target.owner === "agent"
            ? `${target.label} is an agent session; stop it from its own app instead.`
            : `${target.label} wasn't started by an agent or a bb terminal, so it isn't stopped from here.`;
        return { stopped: false, message: reason };
      }
      if (target.owner === "docker" && target.container) {
        try {
          await run("docker", ["stop", target.container], context.signal);
          scanCache.delete(root);
          return { stopped: true, message: `Stopped container ${target.container}.` };
        } catch (error) {
          return { stopped: false, message: error instanceof Error ? error.message : String(error) };
        }
      }
      try {
        process.kill(pid, "SIGTERM");
        scanCache.delete(root);
        probeCache.delete(`${pid}:${port}`);
        return { stopped: true, message: `Sent SIGTERM to ${target.label} (pid ${pid}).` };
      } catch (error) {
        return { stopped: false, message: error instanceof Error ? error.message : String(error) };
      }
    },
  },
});
