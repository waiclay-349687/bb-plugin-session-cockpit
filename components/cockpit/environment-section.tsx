/**
 * [INPUT]: 依赖 data.ts 的 useEnvironment (服务端 environment RPC: 项目 / 仓库 / 类型 / 机器 / 路径); 依赖 @get-bb/plugin-sdk/app 的 experimental_useRpcKeyedQuery 跨插件只读 bb--git 的 status (实时分支与改动数)、useBbNavigate().toCompose (在此环境新建线程);
 *          依赖 lib/environment.ts 的 gitWorkState / splitPath; 依赖 rows.tsx 的行原语与 CopyButton / IconButton
 * [OUTPUT]: 对外提供 EnvironmentSection: 一行 "Environment › 项目名", 点开 = 仓库 (与项目名不同时)、类型 (多机器时带机器名)、分支 + 绿点 (干净) / 橙色 M+个数 (有改动) (仅 git)、路径 (前段省略 + 复制)、在此环境新建线程
 * [POS]: components/cockpit 的"线程跑在哪"项, 承接从输入框底栏移走的项目 / 工作区 / Worktree / 分支 / 新建线程; 消费者: app.tsx (桌面卡片顶部的行, 与 bb 的 Parent / Changes 同层)、cockpit.tsx (横幅详情最上方);
 *        与 bb--git 的边界: 只读它的 status, 读不到时只去掉状态提示、分支回落到环境记录, 本项不隐藏
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import type { ReactNode } from "react";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_useRpcKeyedQuery, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { Icon } from "@/components/ui/icon";
import { gitWorkState, splitPath, type EnvironmentKind, type GitStatusRow } from "../../lib/environment";
import type { MessageKey } from "../../lib/i18n";
import type { EnvironmentResult } from "../../rpc";
import type { SectionProps } from "./cockpit";
import { useEnvironment } from "./data";
import { useText } from "./language";
import { CardRow, CopyButton, Dot, SectionBody, SectionRow } from "./rows";

/** bb 内置的 git 插件; 它的 status 是按环境 id 分键的只读 RPC, 文件或引用变化后自己刷新 */
const GIT_PLUGIN_ID = "bb--git";

/** 只抄本项读的字段 (其余字段 zod 丢弃); 对方改了形状就解析失败, 只是不显示状态提示 */
const gitRowSchema = z.union([
  z.object({
    outcome: z.literal("available"),
    workspace: z.object({
      workingTree: z.object({ fileCount: z.number(), hasUncommittedChanges: z.boolean() }),
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
  worktree: "GitBranch",
  checkout: "FolderGit",
  personal: "Home",
  directory: "Folder",
};

/** 读数行 (名称灰、数值正文色): 数值可能很长 (分支名、owner/repo), 放不下时从末尾截断, 悬停看全文 */
function InfoRow({ label, value, extra, title }: { label: string; value: ReactNode; extra?: ReactNode; title?: string }) {
  return (
    <div className="flex h-6.5 min-w-0 items-center gap-2 px-2 text-xs pointer-coarse:h-9" title={title}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="ml-auto min-w-0 truncate text-right text-foreground">{value}</span>
      {extra}
    </div>
  );
}

/** 路径: 上级目录放不下时截断, 最后一段 (是哪个目录) 完整; 行尾复制按钮 */
function PathRow({ path }: { path: string }) {
  const t = useText();
  const { head, tail } = splitPath(path);
  return (
    <div className="flex h-6.5 min-w-0 items-center gap-2 pl-2 text-xs pointer-coarse:h-9" title={path}>
      <span className="shrink-0 text-muted-foreground">{t("directory")}</span>
      <span className="ml-auto flex min-w-0 justify-end font-mono text-[11px] text-foreground">
        <span className="min-w-0 truncate">{head}</span>
        <span className="shrink-0">{tail}</span>
      </span>
      <CopyButton text={path} label={t("copyPath")} />
    </div>
  );
}

/** 分支一行: 实时分支 (bb--git) 优先, 读不到时用环境记录; 右侧一个灰色小字的工作区状态 */
function BranchRow({ fallback, state }: { fallback: string | null; state: ReturnType<typeof gitWorkState> }) {
  const t = useText();
  const branch = state?.branch ?? fallback;
  const name = branch ?? (state?.detached ? t("detachedHead") : t("noBranch"));
  // 状态只占两三个字符, 把宽度留给分支名: 干净 = 绿点, 有改动 = 橙色 M + 个数 (与 Context files 的 M 同义: 未提交的改动)
  const status =
    state === null ? null : state.kind === "clean" ? (
      <Dot color="var(--success)" label={t("gitClean")} />
    ) : (
      <span className="shrink-0 text-[11px] font-medium tabular-nums" style={{ color: "var(--warning)" }} aria-label={t("changedCount", { count: state.count })}>
        M{state.count}
      </span>
    );
  const hint = state === null ? undefined : state.kind === "clean" ? t("gitClean") : t("changedCount", { count: state.count });
  return (
    <InfoRow
      label={t("branch")}
      title={[branch, hint].filter(Boolean).join(" · ") || undefined}
      value={<span className="font-mono text-[11px]">{name}</span>}
      extra={status}
    />
  );
}

function Details({ env, state }: { env: NonNullable<EnvironmentResult>; state: ReturnType<typeof gitWorkState> }) {
  const t = useText();
  const navigate = useBbNavigate();
  const kind = t(KIND_TEXT[env.kind]);
  return (
    <>
      {/* 项目名已在收起行右侧, 这里不重复 */}
      {env.repository ? <InfoRow label={t("repository")} value={env.repository} title={env.repository} /> : null}
      {/* 没有项目名时收起行写的就是类型 (Personal workspace), 再列一行是重复 */}
      {env.title !== null || env.hostName ? <InfoRow label={t("envKind")} value={env.hostName ? `${kind} · ${env.hostName}` : kind} /> : null}
      {env.git ? <BranchRow fallback={env.git.branch} state={state} /> : null}
      {env.path ? <PathRow path={env.path} /> : null}
      {env.readiness === "ready" ? (
        <CardRow
          icon="MessageSquarePlus"
          label={t("newThreadHere")}
          muted
          onClick={() => navigate.toCompose({ projectId: env.projectId, environmentId: env.environmentId, focusPrompt: true })}
        />
      ) : env.readiness === "preparing" ? (
        <p className="px-2 py-1 text-[11px] leading-4 text-muted-foreground">{t("environmentPending")}</p>
      ) : null}
    </>
  );
}

/**
 * 收起一行: 图标 + Environment + 右侧名字 (项目名; 个人工作区写环境名或 Personal workspace), 与 Claude Desktop 右上角的 Environment 行同一层次。
 * 线程还没有环境时返回 null。git 状态只在展开时订阅, 收起的卡片不给 bb--git 增加负担。
 */
export function EnvironmentSection({ threadId, open, onToggle }: SectionProps) {
  const t = useText();
  const env = useEnvironment(threadId).data;
  const state = useGitWorkState(env?.environmentId ?? null, open && env?.git != null);
  if (!env) return null;
  const name = env.title ?? t(KIND_TEXT[env.kind]);
  return (
    <div>
      <SectionRow
        leading={<Icon name={KIND_ICON[env.kind]} fallback="Folder" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        label={t("environment")}
        summary={<span className="truncate">{name}</span>}
        title={env.path ?? undefined}
        open={open}
        onToggle={onToggle}
      />
      <SectionBody open={open}>
        <Details env={env} state={state} />
      </SectionBody>
    </div>
  );
}
