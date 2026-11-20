/**
 * [INPUT]: 依赖 data.ts 的 useEnvironment (服务端 environment RPC: 项目 / 类型 / 机器 / 路径) 与 useBranches (服务端 branches RPC → 宿主只读 git 列本地分支);
 *          依赖 @get-bb/plugin-sdk/app 的 experimental_useRpcKeyedQuery 跨插件只读 bb--git 的 status (实时分支、改动文件数与新增 / 删除行数)、
 *          experimental_usePanelTabs / experimental_useAppPanel (选中 bb--git 官方的 Diff 标签)、useBbNavigate().toCompose (在此环境新建线程)、experimental_copyToClipboard;
 *          依赖 lib/environment.ts 的 gitWorkState / splitPath / tildePath / filterBranches; 依赖 @radix-ui/react-popover (分支浮层) 与 lib/portal-scope (浮层带插件根标记)
 * [OUTPUT]: 对外提供 EnvironmentSection: Environment 分组里的四行 (不再折叠):
 *           名称 (类型图标 + 项目 / 工作区名, 悬停出现“在此环境新建线程”)、路径 (~ 缩写 + 中间省略, 整行悬停看完整路径, 点击复制)、
 *           分支 (分支名 + ⌄, 点开是可搜索的分支浮层: 当前 / 默认 / 工作树标记, 点条目复制分支名)、改动 (± Changes + 绿色 +N 红色 −M, 干净时写 Clean, 点击打开 bb 官方 Diff)
 * [POS]: components/cockpit 的"线程跑在哪"分组; 消费者: cockpit.tsx (桌面卡片与手机横幅共用, 分组标题 Environment 跟随本板块语言);
 *        与 bb--git 的边界: 只读它的 status、只选中它的 Diff 标签, 具体改动 (文件清单与逐行 diff) 完全交给它, 本分组不重做; 读不到时只去掉改动数, 分支回落到环境记录;
 *        分支浮层只读: 不切换分支、不建分支 (切换会在 agent 正在用的目录底下换代码, 也会让 bb 的环境记录对不上)
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useMemo, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import {
  experimental_copyToClipboard as copyToClipboard,
  experimental_useAppPanel,
  experimental_usePanelTabs,
  experimental_useRpcKeyedQuery,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { usePortalScopeProps } from "../../lib/portal-scope";
import { filterBranches, gitWorkState, splitPath, tildePath, type BranchEntry, type EnvironmentKind, type GitStatusRow, type GitWorkState } from "../../lib/environment";
import type { MessageKey } from "../../lib/i18n";
import type { EnvironmentResult } from "../../rpc";
import type { SectionProps } from "./cockpit";
import { useBranches, useEnvironment } from "./data";
import { useSectionNotice, useText } from "./language";
import { IconButton, PRESSABLE } from "./rows";

/** bb 内置的 git 插件: status 是按环境 id 分键的只读 RPC; 它的 Diff 是线程侧栏里的固定标签 (id "diff") */
const GIT_PLUGIN_ID = "bb--git";
const GIT_DIFF_TAB_ID = "diff";

/** 只抄本分组读的字段 (其余字段 zod 丢弃); 对方改了形状就解析失败, 只是不显示改动数 */
const gitRowSchema = z.union([
  z.object({
    outcome: z.literal("available"),
    workspace: z.object({
      workingTree: z.object({
        fileCount: z.number(),
        hasUncommittedChanges: z.boolean(),
        insertions: z.number().optional(),
        deletions: z.number().optional(),
      }),
      checkout: z.union([
        z.object({ kind: z.literal("branch"), branchName: z.string() }),
        z.object({ kind: z.enum(["detached", "unborn", "unknown"]), branchName: z.string().nullable().optional() }),
      ]),
    }),
  }),
  z.object({ outcome: z.string() }),
]);
const gitContract = defineRpcContract({
  status: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(z.string(), gitRowSchema),
  },
});

function useGitWorkState(environmentId: string | null, enabled: boolean) {
  const query = experimental_useRpcKeyedQuery({
    pluginId: GIT_PLUGIN_ID,
    contract: gitContract,
    method: "status",
    keys: environmentId ? [environmentId] : [],
    enabled: enabled && environmentId !== null,
  });
  return environmentId ? gitWorkState(query.data?.[environmentId] as GitStatusRow | undefined) : null;
}

const KIND_TEXT: Record<EnvironmentKind, MessageKey> = {
  worktree: "envWorktree",
  checkout: "envCheckout",
  personal: "envPersonal",
  directory: "envDirectory",
};
const KIND_ICON: Record<EnvironmentKind, string> = {
  worktree: "FolderGit",
  checkout: "FolderGit",
  personal: "Home",
  directory: "Folder",
};

/** 一行的骨架: 与 rows.tsx 的 CardRow 同尺寸 (26px 行高、12px 字、14px 灰色图标), 可点时整行是按钮 */
const ROW = "flex h-6.5 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs text-foreground pointer-coarse:h-9";
const PRESS = cn(PRESSABLE, "hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-none active:bg-state-active data-[state=open]:bg-state-active");
const ICON = "size-3.5 shrink-0 text-muted-foreground";
/** 行尾的提示图标: 平时不显示, 悬停或聚焦这一行时才出现 (触屏常显) */
const QUIET = "opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-visible/row:opacity-100 pointer-coarse:opacity-100";
const formatCount = (n: number) => n.toLocaleString("en-US");

/** 名称: 类型图标 + 项目 / 工作区名; 悬停出现“在此环境新建线程”; 环境还在准备时写“准备中” */
function NameRow({ env }: { env: NonNullable<EnvironmentResult> }) {
  const t = useText();
  const navigate = useBbNavigate();
  const kind = t(KIND_TEXT[env.kind]);
  const name = env.title ?? kind;
  const detail = [kind, env.repository, env.hostName].filter(Boolean).join(" · ");
  return (
    <div data-cockpit-item="" className={cn("group/row", ROW)} title={detail}>
      <Icon name={KIND_ICON[env.kind]} fallback="Folder" className={ICON} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {env.readiness === "ready" ? (
        <IconButton
          label={t("newThreadHere")}
          className={cn("-mr-1.5", QUIET)}
          onClick={() => navigate.toCompose({ projectId: env.projectId, environmentId: env.environmentId, focusPrompt: true })}
        >
          <Icon name="MessageSquarePlus" fallback="Plus" className="size-3.5" aria-hidden />
        </IconButton>
      ) : env.readiness === "preparing" ? (
        <span className="shrink-0 text-[11px] text-muted-foreground">{t("envPreparing")}</span>
      ) : null}
    </div>
  );
}

/** 路径: 家目录缩成 ~, 上级目录放不下时截断 (中间省略), 末段完整; 整行一个按钮, title 挂在按钮本身上, 悬停任何位置都看到完整路径; 点击复制 */
function PathRow({ path }: { path: string }) {
  const t = useText();
  const notify = useSectionNotice();
  const { head, tail } = splitPath(tildePath(path));
  return (
    <button
      type="button"
      data-cockpit-item=""
      className={cn("group/row", ROW, PRESS)}
      title={path}
      aria-label={`${t("copyPath")}: ${path}`}
      onClick={() => void copyToClipboard({ text: path }).then((ok) => notify(ok ? "success" : "error", ok ? "pathCopied" : "copyFailed"))}
    >
      <Icon name="Folder" className={ICON} aria-hidden />
      <span className="flex min-w-0 flex-1 font-mono text-[11px]">
        <span className="min-w-0 truncate">{head}</span>
        <span className="shrink-0">{tail}</span>
      </span>
      <Icon name="Copy" className={cn(ICON, QUIET)} aria-hidden />
    </button>
  );
}

/** 浮层里当前分支的第二行: 未提交的文件数与行数 (来自 bb--git 的实时状态), 干净时写 Clean */
function CurrentDetail({ state }: { state: GitWorkState | null }) {
  const t = useText();
  if (!state) return null;
  if (state.kind === "clean") return <span className="text-[11px] text-muted-foreground">{t("gitClean")}</span>;
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span>{t("uncommittedFiles", { count: state.count })}</span>
      <LineCounts added={state.insertions} deleted={state.deletions} />
    </span>
  );
}

function LineCounts({ added, deleted }: { added: number; deleted: number }) {
  const t = useText();
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums" aria-label={t("changesSummary", { added: formatCount(added), deleted: formatCount(deleted) })}>
      <span style={{ color: "var(--diff-added)" }}>+{formatCount(added)}</span>
      <span style={{ color: "var(--diff-removed)" }}>−{formatCount(deleted)}</span>
    </span>
  );
}

/** 分支浮层的一条: 名称 + 右侧灰色小标记; 点击复制分支名; 在别的 worktree 检出的分支行尾可复制那个目录 */
function BranchItem({ entry, state, onCopy, onCopyPath }: { entry: BranchEntry; state: GitWorkState | null; onCopy: () => void; onCopyPath: () => void }) {
  const t = useText();
  const tag = entry.current ? t("branchCurrent") : entry.isDefault ? t("branchDefault") : entry.worktreePath ? t("branchWorktree") : null;
  return (
    <div className={cn("group/row flex min-w-0 items-stretch rounded-md", entry.current && "bg-state-active/60")}>
      <button
        type="button"
        role="option"
        aria-selected={entry.current}
        className={cn("flex min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-md px-2 py-1.5 text-left", PRESS)}
        title={entry.worktreePath ? `${entry.name} · ${tildePath(entry.worktreePath)}` : entry.name}
        onClick={onCopy}
      >
        <span className="flex w-full min-w-0 items-center gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
          {tag ? <span className="shrink-0 text-[11px] text-muted-foreground">{tag}</span> : null}
        </span>
        {entry.current ? <CurrentDetail state={state} /> : null}
      </button>
      {entry.worktreePath ? (
        <IconButton label={t("copyWorktreePath")} className={cn("self-center", QUIET)} onClick={onCopyPath}>
          <Icon name="Copy" className="size-3.5" aria-hidden />
        </IconButton>
      ) : (
        // 与复制路径按钮同宽的占位, 让各行的标签 (current / default / worktree) 右缘对齐
        <span aria-hidden className="w-6 shrink-0 pointer-coarse:w-9" />
      )}
    </div>
  );
}

/** 分支: 名称 + ⌄; 点开是可搜索的分支浮层 (对标 Synara), 只在打开时读分支清单; 只读, 点条目复制分支名 */
function BranchRow({ threadId, fallback, state }: { threadId: string; fallback: string | null; state: GitWorkState | null }) {
  const t = useText();
  const notify = useSectionNotice();
  const portal = usePortalScopeProps();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const list = useBranches(threadId, open);
  const branch = state?.branch ?? fallback;
  const name = branch ?? (state?.detached ? t("detachedHead") : t("noBranch"));
  const shown = useMemo(() => filterBranches(list.data?.branches ?? [], query), [list.data, query]);
  const copy = (text: string, key: MessageKey) => void copyToClipboard({ text }).then((ok) => notify(ok ? "success" : "error", ok ? key : "copyFailed"));
  let body: ReactNode;
  if (!list.data) body = <p className="px-2 py-3 text-xs text-muted-foreground">{list.error ? t("branchesUnavailable") : t("branchesLoading")}</p>;
  else if (shown.length === 0) body = <p className="px-2 py-3 text-xs text-muted-foreground">{t("noBranchMatch")}</p>;
  else
    body = shown.map((entry) => (
      <BranchItem
        key={entry.name}
        entry={entry}
        state={state}
        onCopy={() => {
          copy(entry.name, "branchCopied");
          setOpen(false);
        }}
        onCopyPath={() => entry.worktreePath && copy(entry.worktreePath, "pathCopied")}
      />
    ));
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <Popover.Trigger asChild>
        <button type="button" data-cockpit-item="" className={cn("group/row", ROW, PRESS)} title={branch ?? undefined} aria-label={`${t("branch")}: ${name}`}>
          <Icon name="GitBranch" className={ICON} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <Icon name="ChevronDown" className={cn("size-3 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          {...portal}
          align="start"
          side="bottom"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 flex max-h-[min(24rem,var(--radix-popover-content-available-height))] w-[min(20rem,var(--radix-popover-content-available-width))] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
            <Icon name="Search" className={ICON} aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchBranches")}
              aria-label={t("searchBranches")}
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div role="listbox" aria-label={t("branchMenu")} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
            {body}
          </div>
          <p className="border-t border-border px-2.5 py-1.5 text-[11px] text-muted-foreground">{t("copyBranchHint")}</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * 改动: ± Changes + 绿色 +N 红色 −M (干净时写 Clean)。点击选中 bb--git 官方的 Diff 标签 (具体文件与逐行 diff 交给它);
 * 那个标签不在侧栏里时提示用 ⌘D 打开 (插件不能替别的插件开它的标签)。
 */
function ChangesRow({ state }: { state: GitWorkState | null }) {
  const t = useText();
  const notify = useSectionNotice();
  const panel = experimental_useAppPanel();
  const tabs = experimental_usePanelTabs();
  const diffTab = tabs.tabs.find((tab) => tab.detail.kind === "plugin" && tab.detail.pluginId === GIT_PLUGIN_ID && tab.detail.tab.id === GIT_DIFF_TAB_ID);
  const trailing =
    state === null ? null : state.kind === "clean" ? (
      <span className="text-muted-foreground">{t("gitClean")}</span>
    ) : state.insertions + state.deletions > 0 ? (
      <LineCounts added={state.insertions} deleted={state.deletions} />
    ) : (
      <span className="text-muted-foreground">{t("changedCount", { count: state.count })}</span>
    );
  return (
    <button
      type="button"
      data-cockpit-item=""
      className={cn("group/row", ROW, PRESS)}
      // 与宿主自带的 "Changes" (整条分支相对基线) 区分: 这里只算工作区里还没提交的改动
      title={[state?.kind === "changed" ? t("uncommittedFiles", { count: state.count }) : null, diffTab ? t("openDiff") : t("diffShortcutHint")].filter(Boolean).join(" · ")}
      onClick={() => {
        if (!diffTab || !panel.selectTab(diffTab.key)) notify("success", "diffShortcutHint");
      }}
    >
      <Icon name="FileDiff" fallback="FileText" className={ICON} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{t("changes")}</span>
      <span className="ml-auto flex shrink-0 items-center text-xs tabular-nums">{trailing}</span>
    </button>
  );
}

/**
 * Environment 分组的内容 (分组标题由 cockpit.tsx 画): 名称、路径, git 环境再加分支与改动。
 * 线程还没有环境时返回 null (整组不出现)。git 状态在有 git 时订阅 (bb--git 文件变化后自己推送, 不轮询)。
 */
export function EnvironmentSection({ threadId }: SectionProps) {
  const env = useEnvironment(threadId).data;
  const state = useGitWorkState(env?.environmentId ?? null, env?.git != null);
  if (!env) return null;
  return (
    <div>
      <NameRow env={env} />
      {env.path ? <PathRow path={env.path} /> : null}
      {env.git ? <BranchRow threadId={threadId} fallback={env.git.branch} state={state} /> : null}
      {env.git ? <ChangesRow state={state} /> : null}
    </div>
  );
}
