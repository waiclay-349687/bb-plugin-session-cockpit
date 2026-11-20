/**
 * [INPUT]: 只依赖语言内置能力; 输入是 bb 的环境 / 项目 / 机器 DTO 与 bb--git 插件 status 行里用得到的字段
 * [OUTPUT]: 对外提供 environmentInfo (归一成 Environment 分区要显示的信息, 不存在的项直接没有字段)、gitWorkState (工作区干净 / n 个改动, 带新增 / 删除行数)、repositoryName (remote → owner/repo)、splitPath (路径前段可截断、末段完整)、tildePath (家目录缩成 ~);
 *           分支浮层的解析: parseWorktreeList / defaultBranchName / buildBranches / filterBranches（具体改动交给 bb 官方 diff, 这里不解析文件清单）
 * [POS]: lib 的环境领域核心, 无 IO; 消费者: server.ts (environment RPC)、host.ts (listBranches: 只读 git 的输出交给这里解析)、components/cockpit/environment-section.tsx; 与 context-files.ts 的边界: 那边管上下文文件, 这里只管"线程跑在哪"
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */

/** 界面上的环境类型; 显示文案在 i18n 里 (env* 词条) */
export type EnvironmentKind = "worktree" | "checkout" | "personal" | "directory";

/** 只抄用到的字段, 便于测试直接用真实样本 */
export interface EnvironmentInput {
  id: string;
  /** 项目读取失败时的回落 */
  projectId: string;
  name: string | null;
  path: string | null;
  branchName: string | null;
  isGitRepo: boolean;
  isWorktree: boolean;
  status: string;
  workspaceProvisionType: "managed-worktree" | "personal" | "unmanaged" | null;
}
export interface ProjectInput {
  id: string;
  name: string;
  kind: "personal" | "standard";
  gitRemoteUrl: string | null;
}
export interface HostInput {
  id: string;
  name: string;
}

export interface EnvironmentInfo {
  environmentId: string;
  projectId: string;
  /** 收起行右侧的名字: 仓库项目用项目名, 个人工作区用环境名 (没有时由界面写 Personal workspace) */
  title: string | null;
  kind: EnvironmentKind;
  /** owner/repo; 没有 remote 或与项目名相同 (不重复显示) 时没有 */
  repository: string | null;
  /** 只有 git 环境才有; 线程在非 git 目录里时整行不存在 */
  git: { branch: string | null } | null;
  path: string | null;
  /** 只有多于一台机器时才写机器名: host schema 没有"是否远程"的字段, 一台机器时写出来是噪音 */
  hostName: string | null;
  /** ready 才能在里面新建线程; preparing (creating / provisioning) 显示一句"仍在准备"; unavailable (error / destroyed) 什么都不显示 */
  readiness: "ready" | "preparing" | "unavailable";
}

/**
 * provision 类型优先 (bb 自己建的 worktree / 个人工作区); 旧数据或手动加的目录再看 git 标记。
 * 手动加进来的 `git worktree` 目录 (unmanaged + isWorktree) 也算 Worktree。
 */
export function environmentKind(env: Pick<EnvironmentInput, "workspaceProvisionType" | "isWorktree" | "isGitRepo">): EnvironmentKind {
  if (env.workspaceProvisionType === "personal") return "personal";
  if (env.workspaceProvisionType === "managed-worktree" || env.isWorktree) return "worktree";
  return env.isGitRepo ? "checkout" : "directory";
}

/** `git@github.com:owner/repo.git`、`https://github.com/owner/repo`、`ssh://git@host:22/owner/repo.git` → `owner/repo` */
export function repositoryName(remote: string | null | undefined): string | null {
  const trimmed = remote?.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  if (!trimmed) return null;
  const path = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*\/?/i, "")
    : trimmed.includes(":") ? trimmed.slice(trimmed.indexOf(":") + 1) : trimmed;
  const parts = path.split("/").filter(Boolean);
  return parts.length === 0 ? null : parts.slice(-2).join("/");
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function environmentInfo(
  env: EnvironmentInput,
  project: ProjectInput | null,
  host: HostInput | null,
  hostCount: number,
): EnvironmentInfo {
  const kind = environmentKind(env);
  const repo = repositoryName(project?.gitRemoteUrl);
  // 仓库名与项目名相同 (只比较 owner/repo 的最后一段, 不分大小写) 时不另起一行
  const repoTail = repo?.split("/").pop() ?? null;
  const repository = repo && project && repoTail && sameName(repoTail, project.name) ? null : repo;
  const personal = kind === "personal" || project?.kind === "personal";
  return {
    environmentId: env.id,
    projectId: project?.id ?? env.projectId,
    title: personal ? env.name : project?.name ?? env.name,
    kind,
    repository: personal ? null : repository,
    git: env.isGitRepo ? { branch: env.branchName } : null,
    path: env.path,
    hostName: hostCount > 1 && host ? host.name : null,
    readiness: env.status === "ready" ? "ready" : env.status === "creating" || env.status === "provisioning" ? "preparing" : "unavailable",
  };
}

/** bb--git 插件 status 行里用到的字段 (形状对不上时调用方传 null) */
export type GitStatusRow =
  | {
      outcome: "available";
      workspace: {
        workingTree: { fileCount: number; hasUncommittedChanges: boolean; insertions?: number; deletions?: number };
        checkout: { kind: "branch"; branchName: string } | { kind: "detached" | "unborn" | "unknown"; branchName?: string | null };
      };
    }
  | { outcome: string };

export type GitWorkState =
  | { kind: "clean"; branch: string | null; detached: boolean }
  | { kind: "changed"; count: number; insertions: number; deletions: number; branch: string | null; detached: boolean };

/** 读不到 (插件没装、非 git、还没算出来) 时返回 null: 界面只去掉状态提示, 分支回落到环境记录的 branchName */
export function gitWorkState(row: GitStatusRow | null | undefined): GitWorkState | null {
  if (!row || row.outcome !== "available" || !("workspace" in row)) return null;
  const { workingTree, checkout } = row.workspace;
  const branch = checkout.branchName ?? null;
  const detached = checkout.kind === "detached";
  return workingTree.hasUncommittedChanges || workingTree.fileCount > 0
    ? { kind: "changed", count: workingTree.fileCount, insertions: workingTree.insertions ?? 0, deletions: workingTree.deletions ?? 0, branch, detached }
    : { kind: "clean", branch, detached };
}

/**
 * 路径放不下时从中间省略: 末段说明"是哪个目录", 必须完整; 前段 (上级目录) 才截断。
 * 返回 head (含末尾分隔符, 可截断) 与 tail (不截断); 根目录、单段路径 head 为空。
 */
export function splitPath(path: string): { head: string; tail: string } {
  const trimmed = path.length > 1 ? path.replace(/[\\/]+$/, "") : path;
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (cut <= 0 || cut === trimmed.length - 1) return { head: "", tail: trimmed };
  return { head: trimmed.slice(0, cut + 1), tail: trimmed.slice(cut + 1) };
}

/** 家目录缩成 ~：macOS 的 /Users/<名>、Linux 的 /home/<名>、Windows 的 C:\Users\<名>；其余原样 */
export function tildePath(path: string): string {
  return path.replace(/^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=$|[\\/])/, "~");
}

/** 分支浮层里的一条 */
export interface BranchEntry {
  name: string;
  current: boolean;
  isDefault: boolean;
  /** 这个分支在另一个 worktree 里检出时的路径（当前目录检出的不算） */
  worktreePath: string | null;
}

/** `git worktree list --porcelain` → 每个 worktree 的路径与检出的分支（游离 HEAD 时为 null） */
export function parseWorktreeList(output: string): { path: string; branch: string | null }[] {
  const list: { path: string; branch: string | null }[] = [];
  let current: { path: string; branch: string | null } | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length), branch: null };
      list.push(current);
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
  }
  return list;
}

/**
 * 默认分支：远端 HEAD 指向的（origin/main → main）；读不到时本地有 main 就是 main，再看 master；都没有为 null。
 * 远端 HEAD 指向的分支本地没有时也认它（浮层里只是不会出现那一条）。
 */
export function defaultBranchName(originHead: string | null | undefined, local: readonly string[]): string | null {
  const remote = originHead?.trim();
  if (remote) return remote.replace(/^[^/]+\//, "");
  return ["main", "master"].find((name) => local.includes(name)) ?? null;
}

/**
 * 浮层的分支清单：当前分支置顶，其次默认分支，再是在别的 worktree 里检出的，其余按传入顺序（最近提交在前）。
 * 当前目录检出的分支不算“有独立 worktree”。
 */
export function buildBranches(input: {
  refs: readonly string[];
  current: string | null;
  defaultBranch: string | null;
  worktrees: readonly { path: string; branch: string | null }[];
  root: string;
}): BranchEntry[] {
  const norm = (p: string) => p.replace(/[\\/]+$/, "");
  const elsewhere = new Map(input.worktrees.filter((w) => w.branch && norm(w.path) !== norm(input.root)).map((w) => [w.branch!, w.path]));
  const entries = input.refs.map((name) => ({
    name,
    current: name === input.current,
    isDefault: name === input.defaultBranch,
    worktreePath: name === input.current ? null : elsewhere.get(name) ?? null,
  }));
  const rank = (e: BranchEntry) => (e.current ? 0 : e.isDefault ? 1 : e.worktreePath ? 2 : 3);
  return entries.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map(({ e }) => e);
}

/** 浮层搜索：空格分词、每个词都要出现在分支名里（不分大小写）；空查询给全部 */
export function filterBranches(entries: readonly BranchEntry[], query: string): BranchEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((e) => words.every((w) => e.name.toLowerCase().includes(w)));
}
