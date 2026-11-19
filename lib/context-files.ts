/**
 * [INPUT]: 无外部依赖 (不碰 node:path / node:os: 本文件同时进浏览器包, home 与"是不是文件"由调用方传入)
 * [OUTPUT]: 对外提供上下文文件的纯逻辑: CONTEXT_LEVELS / LEVEL_LABELS / ContextFile 等类型; 发现侧 (host.ts 用) candidatePaths / listedDirs / parentDirs / memorySlug / classifyPath / classifyRelative / compareRelative / parseGitStatus / changedMatcher / resolveImports / extractImportTokens;
 *           展示侧 (前端用) loadedEntries / mergeLoaded / summarize / groupByLevel / inlineSelection / groupByTopDir / fileLabel / relativePath
 * [POS]: lib 层的"上下文文件"领域核心 (词汇见 GLOSSARY.md): 扫描元数据可供 context-estimate.ts 估算文件占用；一个文件只属于一个层级, 层级由路径唯一决定; 消费者: host.ts (发现)、contract.ts (层级枚举)、components/cockpit/context-files-section.tsx (展示)、test;
 *        与 lib/usage.ts 的边界: 那边管上下文窗口的占用口径, 本文件只借用它的 Memory files 分类条目来判断"已加载"
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */

// ---------------------------------------------------------------------------
// 层级
// ---------------------------------------------------------------------------

/** 顺序即显示顺序 */
export const CONTEXT_LEVELS = ["global", "parent", "project", "modules", "local", "rules", "memory"] as const;
export type ContextLevel = (typeof CONTEXT_LEVELS)[number];

export const LEVEL_LABELS: Record<ContextLevel, string> = {
  global: "Global",
  parent: "Parent",
  project: "Project",
  modules: "Modules",
  local: "Local",
  rules: "Rules",
  memory: "Memory",
};

export interface ContextImport {
  path: string;
  name: string;
}

export interface ContextFile {
  /** 绝对路径 */
  path: string;
  level: ContextLevel;
  /** 文件名 */
  name: string;
  /** 所在目录: 工作区内的写相对工作区根的路径 (根目录为空串), 工作区外的把 home 缩写成 ~ */
  dir: string;
  /** 工作区里有未提交改动 (含未跟踪); 仓库外的文件恒为 false */
  changed: boolean;
  /** 扫描导入时顺带取得的磁盘字节数 */
  sizeBytes?: number;
  /** 被本文件用 @路径 引进来的文件, 只展开一层 */
  imports: ContextImport[];
}

/** 全局层级的文件, 相对 home */
const GLOBAL_FILES = [".claude/CLAUDE.md", ".codex/AGENTS.md", ".gemini/GEMINI.md"];
/** 工作区之上各层目录里认的文件名 */
const PARENT_NAMES = ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", "AGENTS.override.md", "GEMINI.md"];
/** 工作区根目录里算"项目"层级的文件名 (CLAUDE.local.md 归本地私有) */
const PROJECT_NAMES = ["CLAUDE.md", "AGENTS.md", "AGENTS.override.md", "GEMINI.md"];
/** 子目录里算"模块"层级的文件名, 精确匹配 */
const MODULE_NAMES = ["CLAUDE.md", "AGENTS.md", "GEMINI.md"];
const LOCAL_NAME = "CLAUDE.local.md";
const MEMORY_INDEX = "MEMORY.md";
const PARENT_MAX_DEPTH = 12;
/** 只有这些层级的文件会被打开找导入: 模块几十上百个、自动记忆是 agent 自己写的, 都不读 */
export const IMPORT_LEVELS: readonly ContextLevel[] = ["global", "parent", "project", "local", "rules"];

// ---------------------------------------------------------------------------
// 路径 (只处理 posix 绝对路径)
// ---------------------------------------------------------------------------

const trimSlash = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, "") : path);
const join = (dir: string, rel: string): string => (dir === "/" ? `/${rel}` : `${dir}/${rel}`);
const isMarkdown = (name: string): boolean => name.toLowerCase().endsWith(".md");

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** 消掉 . 与 .. */
function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

const isUnder = (path: string, dir: string): boolean => (dir === "/" ? path.startsWith("/") && path !== "/" : path.startsWith(`${dir}/`));

function tilde(path: string, home: string): string {
  if (path === home) return "~";
  return isUnder(path, home) ? `~/${path.slice(home.length + 1)}` : path;
}

/** Claude Code 给每个工作区建自动记忆目录时用的名字: 绝对路径里的 / . _ 全换成 - */
export function memorySlug(root: string): string {
  return trimSlash(root).replace(/[/._]/g, "-");
}

/**
 * 工作区之上的各层目录, 由近到远。最多 12 层; 工作区在 home 之下时走到 home 为止 (含 home 本身, 不含它下面的 .claude: 那是全局),
 * 否则走到 / 为止。
 */
export function parentDirs(root: string, home: string): string[] {
  const start = trimSlash(root);
  const stop = isUnder(start, trimSlash(home)) ? trimSlash(home) : "/";
  const dirs: string[] = [];
  let dir = start;
  while (dir !== "/" && dir !== stop && dirs.length < PARENT_MAX_DEPTH) {
    dir = dirname(dir);
    dirs.push(dir);
  }
  return dirs;
}

/** 位置固定、逐个 stat 就能确认的候选 (全局、上级目录、项目、根目录的本地私有) */
export function candidatePaths(root: string, home: string): string[] {
  const base = trimSlash(root);
  const user = trimSlash(home);
  return [
    ...GLOBAL_FILES.map((rel) => join(user, rel)),
    ...parentDirs(base, user).flatMap((dir) => PARENT_NAMES.map((name) => join(dir, name))),
    ...PROJECT_NAMES.map((name) => join(base, name)),
    join(base, ".claude/CLAUDE.md"),
    join(base, LOCAL_NAME),
  ];
}

/** 要列目录的位置: 目录下直接放着的 *.md 都算 (自动记忆、规则) */
export function listedDirs(root: string, home: string): string[] {
  const base = trimSlash(root);
  const user = trimSlash(home);
  return [
    join(user, `.claude/projects/${memorySlug(base)}/memory`),
    join(base, ".claude/memory"),
    join(base, ".claude/rules"),
    join(user, ".claude/rules"),
  ];
}

/** 工作区内的相对路径 → 层级; 不是上下文文件返回 null */
export function classifyRelative(rel: string): ContextLevel | null {
  const name = basename(rel);
  const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
  if (name === LOCAL_NAME) return "local";
  if (dir === "") return PROJECT_NAMES.includes(name) ? "project" : null;
  if (rel === ".claude/CLAUDE.md") return "project";
  if (dir === ".claude/rules") return isMarkdown(name) ? "rules" : null;
  if (dir === ".claude/memory") return isMarkdown(name) ? "memory" : null;
  return MODULE_NAMES.includes(name) ? "modules" : null;
}

/** 相对路径的排序: 按目录逐段比 (父目录排在它的子目录之前, 不受文件名干扰), 同目录再按文件名 */
export function compareRelative(a: string, b: string): number {
  const left = a.split("/");
  const right = b.split("/");
  const depth = Math.min(left.length, right.length) - 1;
  for (let i = 0; i < depth; i++) {
    const order = left[i]!.localeCompare(right[i]!);
    if (order !== 0) return order;
  }
  return left.length - right.length || left[depth]!.localeCompare(right[depth]!);
}

/** 绝对路径 → 层级 + 显示用的文件名与目录; 层级由路径唯一决定, 不是上下文文件返回 null */
export function classifyPath(path: string, env: { root: string; home: string }): Pick<ContextFile, "level" | "name" | "dir"> | null {
  const root = trimSlash(env.root);
  const home = trimSlash(env.home);
  const name = basename(path);
  const dir = dirname(path);
  const outside = (level: ContextLevel) => ({ level, name, dir: tilde(dir, home) });
  // 全局与用户目录下的规则、自动记忆先判: 工作区就是 home 时它们也不该被当成项目文件
  if (GLOBAL_FILES.some((rel) => join(home, rel) === path)) return outside("global");
  if (dir === join(home, ".claude/rules")) return isMarkdown(name) ? outside("rules") : null;
  if (dir === join(home, `.claude/projects/${memorySlug(root)}/memory`)) return isMarkdown(name) ? outside("memory") : null;
  if (isUnder(path, root)) {
    const rel = root === "/" ? path.slice(1) : path.slice(root.length + 1);
    const level = classifyRelative(rel);
    return level ? { level, name, dir: rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "" } : null;
  }
  if (PARENT_NAMES.includes(name) && parentDirs(root, home).includes(dir)) return outside("parent");
  return null;
}

// ---------------------------------------------------------------------------
// git status → 有改动
// ---------------------------------------------------------------------------

export interface GitStatus {
  /** 相对工作区根的路径; 以 / 结尾的是整个未跟踪目录 */
  changed: string[];
  /** 工作区里已删除但索引里还在的文件: ls-files 仍会列出, 要剔掉 */
  deleted: string[];
}

/**
 * 解析 `git status --porcelain -z`。路径相对仓库顶层, 工作区根是仓库子目录时用 prefix (如 "packages/app/") 换算成相对工作区根,
 * 不在 prefix 之下的丢弃。改名与复制的条目后面多跟一个"原路径"字段, 跳过。
 */
export function parseGitStatus(output: string, prefix = ""): GitStatus {
  const changed: string[] = [];
  const deleted: string[] = [];
  const fields = output.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i]!;
    if (entry.length < 4) continue;
    const x = entry[0]!;
    const y = entry[1]!;
    const path = entry.slice(3);
    if ("RC".includes(x) || "RC".includes(y)) i++;
    if (x === "!" || !path.startsWith(prefix)) continue;
    const rel = path.slice(prefix.length);
    if (rel === "") continue;
    (y === "D" || (x === "D" && y === " ") ? deleted : changed).push(rel);
  }
  return { changed, deleted };
}

/** 相对路径 → 是否有未提交改动; 未跟踪目录下的文件按前缀算 */
export function changedMatcher(status: GitStatus): (rel: string) => boolean {
  const exact = new Set(status.changed.filter((path) => !path.endsWith("/")));
  const dirs = status.changed.filter((path) => path.endsWith("/"));
  return (rel) => exact.has(rel) || dirs.some((dir) => rel.startsWith(dir));
}

// ---------------------------------------------------------------------------
// 导入 (@路径)
// ---------------------------------------------------------------------------

const MAX_IMPORT_TOKENS = 50;

/** 文本里围栏代码块与行内代码之外的 @token, 去重、去掉句末标点 */
export function extractImportTokens(text: string): string[] {
  const tokens = new Set<string>();
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s*(```|~~~)/.exec(line)?.[1] ?? null;
    if (marker && (fence === null || fence === marker)) {
      fence = fence === null ? marker : null;
      continue;
    }
    if (fence !== null) continue;
    for (const match of line.replace(/`[^`]*`/g, " ").matchAll(/(^|\s)@([^\s`'"()<>]+)/g)) {
      const token = match[2]!.replace(/[.,;:!?]+$/, "");
      if (token !== "" && tokens.size < MAX_IMPORT_TOKENS) tokens.add(token);
    }
  }
  return [...tokens];
}

/**
 * 一个上下文文件导入了哪些文件: token 相对导入者所在目录解析 (也认 ~/ 与绝对路径), 只有落到真实存在的普通文件才算导入。
 * `@get-bb/plugin-sdk` 这类 npm 包名解析不到文件, 自然被排除。isFile 由调用方注入 (宿主端是 fs.stat), 本函数自己不做 IO。
 */
export async function resolveImports(
  text: string,
  importerPath: string,
  home: string,
  isFile: (path: string) => boolean | Promise<boolean>,
): Promise<ContextImport[]> {
  const base = dirname(importerPath);
  const user = trimSlash(home);
  const paths = new Set<string>();
  for (const token of extractImportTokens(text)) {
    if (token === "~") continue;
    const path = normalize(token.startsWith("~/") ? join(user, token.slice(2)) : token.startsWith("/") ? token : join(base, token));
    if (path !== importerPath) paths.add(path);
  }
  const found = await Promise.all([...paths].map(async (path) => ((await isFile(path)) ? path : null)));
  return found.filter((path): path is string => path !== null).map((path) => ({ path, name: basename(path) }));
}

// ---------------------------------------------------------------------------
// 已加载 (只有一个来源: provider 的上下文明细里 Memory files 分类的条目)
// ---------------------------------------------------------------------------

export interface LoadedEntry {
  /** 条目标签: 绝对路径 */
  label: string;
  tokens: number;
}

export interface ContextFileView extends ContextFile {
  /** true / false 只在有上下文明细时出现; null = 不知道 (Codex 线程、明细还没采到) */
  loaded: boolean | null;
  /** 已加载时这份文件占的 token */
  tokens: number | null;
}

/**
 * 从会话快照取"已加载"的依据。估算明细或没有明细 返回 null = 不知道;
 * 有明细但没有 Memory files 分类 = 确实一个都没加载。
 */
export function loadedEntries(
  context: { breakdownEstimated?: boolean; categories: readonly { label: string; entries: readonly LoadedEntry[] }[] } | null | undefined,
): LoadedEntry[] | null {
  if (!context || context.breakdownEstimated || context.categories.length === 0) return null;
  return [...(context.categories.find((category) => category.label === "Memory files")?.entries ?? [])];
}

/** macOS 上 /tmp、/var、/etc 是 /private 下的符号链接, 两种写法算同一个路径 */
const realish = (path: string): string => path.replace(/^\/private(?=\/(?:tmp|var|etc)(?:\/|$))/, "");

export function mergeLoaded(files: readonly ContextFile[], entries: readonly LoadedEntry[] | null): ContextFileView[] {
  if (entries === null) return files.map((file) => ({ ...file, loaded: null, tokens: null }));
  const tokens = new Map(entries.map((entry) => [realish(entry.label), entry.tokens]));
  return files.map((file) => {
    const hit = tokens.get(realish(file.path));
    return { ...file, loaded: hit !== undefined, tokens: hit ?? null };
  });
}

// ---------------------------------------------------------------------------
// 展示: 汇总、分层、就地列哪些、弹层里怎么分组、行上写什么
// ---------------------------------------------------------------------------

export interface ContextSummary {
  /** 上下文文件个数; 导入跟随导入者, 不计数 */
  total: number;
  /** null = 不知道 */
  loaded: number | null;
  changed: number;
}

export function summarize(files: readonly ContextFileView[]): ContextSummary {
  const known = files.every((file) => file.loaded !== null);
  return {
    total: files.length,
    loaded: known ? files.filter((file) => file.loaded === true).length : null,
    changed: files.filter((file) => file.changed).length,
  };
}

export interface LevelGroup extends ContextSummary {
  level: ContextLevel;
  label: string;
  files: ContextFileView[];
}

/** 按层级分组, 顺序固定, 没有文件的层级不出现 */
export function groupByLevel(files: readonly ContextFileView[]): LevelGroup[] {
  return CONTEXT_LEVELS.map((level) => {
    const members = files.filter((file) => file.level === level);
    return { level, label: LEVEL_LABELS[level], files: members, ...summarize(members) };
  }).filter((group) => group.total > 0);
}

export const INLINE_LIMIT = 8;

/**
 * 一个层级点开后就地列哪些文件。不超过 limit 个就全列; 更多时只列值得一眼看到的
 * (已加载的、有改动的、自动记忆的索引 MEMORY.md), 最多 limit 个, 其余进弹层 (showAll)。
 * 模块层级因此不会变成几十行的墙: 实测上下文明细从不列模块文件, 那里通常只剩有改动的几个。
 */
export function inlineSelection(group: LevelGroup, limit = INLINE_LIMIT): { files: ContextFileView[]; showAll: boolean } {
  const pinned = (file: ContextFileView) => file.level === "memory" && file.name === MEMORY_INDEX;
  // 索引 → 已加载 → 有改动; 同档保持原顺序
  const rank = (file: ContextFileView) => (pinned(file) ? 0 : file.loaded === true ? 1 : file.changed ? 2 : 3);
  const ordered = [...group.files].sort((a, b) => rank(a) - rank(b));
  if (ordered.length <= limit) return { files: group.level === "memory" ? ordered : group.files, showAll: false };
  return { files: ordered.filter((file) => rank(file) < 3).slice(0, limit), showAll: true };
}

/** 相对工作区根的路径 (工作区外的是带 ~ 的路径); 弹层过滤按它匹配 */
export function relativePath(file: Pick<ContextFile, "dir" | "name">): string {
  return file.dir === "" ? file.name : `${file.dir}/${file.name}`;
}

export interface DirGroup {
  name: string;
  files: ContextFileView[];
}

/**
 * 弹层里按顶层目录分组: 组按文件数降序 (同数按名字), 只有一两个文件的顶层目录并进末尾的 other,
 * 免得十几个只有一行的小组把列表切碎。
 */
export function groupByTopDir(files: readonly ContextFileView[], minGroup = 3): DirGroup[] {
  const byTop = new Map<string, ContextFileView[]>();
  for (const file of files) {
    const top = file.dir.split("/")[0] || ".";
    byTop.set(top, [...(byTop.get(top) ?? []), file]);
  }
  const groups = [...byTop].map(([name, members]) => ({ name, files: members }));
  const large = groups.filter((group) => group.files.length >= minGroup).sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name));
  const small = groups.filter((group) => group.files.length < minGroup).flatMap((group) => group.files);
  return small.length > 0 ? [...large, { name: "other", files: small }] : large;
}

/**
 * 行上写什么。text 是主角, suffix 是灰色的补充。
 * 模块与子目录里的本地私有文件: 目录就是它管的范围, 所以写目录路径, 文件名是默认的那个就不写;
 * 其余层级写文件名, 目录只在能区分来源时作补充。
 */
export function fileLabel(file: Pick<ContextFile, "level" | "name" | "dir">): { text: string; suffix: string | null } {
  const { level, name, dir } = file;
  const outside = dir.startsWith("~") || dir.startsWith("/");
  switch (level) {
    case "modules":
      return { text: dir, suffix: name === "CLAUDE.md" ? null : name };
    case "local":
      return dir === "" ? { text: name, suffix: null } : { text: dir, suffix: name === LOCAL_NAME ? null : name };
    case "parent":
      return { text: `${dir === "/" ? "" : basename(dir)}/${name}`, suffix: null };
    case "project":
      return { text: relativePath(file), suffix: null };
    case "global":
      return { text: name, suffix: dir };
    case "rules":
      return { text: name, suffix: outside ? dir.replace(/\/rules$/, "") : null };
    case "memory":
      return { text: name, suffix: outside ? null : dir.replace(/\/memory$/, "") };
  }
}
