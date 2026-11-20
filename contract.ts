/**
 * [INPUT]: 依赖 @get-bb/plugin-sdk 的 defineRpcContract 与 zod; 依赖 lib/context-files.ts 的层级枚举
 * [OUTPUT]: 对外提供 hostContract: server.ts 与 host.ts 之间的宿主 RPC 契约 (listListeners / stopListener / listContextFiles / listBranches); listenerSchema 与 contextFileSchema（含各层级字节数及符号链接目标）供 rpc.ts 复用
 * [POS]: 插件根的跨进程契约层; 消费者: server.ts (bb.hosts.experimental_client)、host.ts (experimental_defineHostEntry); 与 server.ts 内 rpcContract 的边界: 本契约只走 server↔宿主机, 前端看不到
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CONTEXT_LEVELS } from "./lib/context-files.ts";

export const listenerSchema = z.object({
  pid: z.number().int(),
  command: z.string(),
  /** 给人看的进程名 (版本号命名的二进制会还原成工具名) */
  label: z.string(),
  port: z.number().int(),
  addresses: z.array(z.string()),
  cwd: z.string().nullable(),
  url: z.string(),
  /** 对 http://127.0.0.1:port 的 HEAD 探测是否有响应; null = 未探测 (agent 会话自己的端口不探测) */
  http: z.boolean().nullable(),
  /** 归属: agent 进程本身 / agent 起的子进程 / bb 终端里起的 / 其他 (见 lib/lsof.ts classifyOwnership) */
  owner: z.enum(["agent", "agent-child", "terminal", "docker", "other"]),
  /** docker compose 容器发布的端口: 容器名; 普通进程为 null */
  container: z.string().nullable(),
  /** 工作区 .bb/ports.json 给这个端口起的名字 */
  name: z.string().nullable(),
  ownerAgent: z.string().nullable(),
  /** 进程环境里的 BB_THREAD_ID: 启动它的 bb 线程; 读不到为 null */
  threadId: z.string().nullable(),
  /** agent-child、terminal 与 docker (工作区 compose 容器) 可以从面板停止; 宿主端停止前会重新判定 */
  stoppable: z.boolean(),
});
export type ListenerInfo = z.infer<typeof listenerSchema>;

/** 一个上下文文件 (形状与 lib/context-files.ts 的 ContextFile 一致) */
export const contextFileSchema = z.object({
  path: z.string(),
  level: z.enum(CONTEXT_LEVELS),
  name: z.string(),
  /** 所在目录: 工作区内的相对工作区根 (根目录为空串), 工作区外的把 home 缩写成 ~ */
  dir: z.string(),
  /** 工作区里有未提交改动 (含未跟踪); 仓库外的文件恒为 false */
  changed: z.boolean(),
  realPath: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  /** 被它用 @路径 引进来的文件, 只展开一层 */
  imports: z.array(z.object({ path: z.string(), name: z.string() })),
});

/** 分支浮层的一条（形状与 lib/environment.ts 的 BranchEntry 一致） */
export const branchEntrySchema = z.object({
  name: z.string(),
  current: z.boolean(),
  isDefault: z.boolean(),
  worktreePath: z.string().nullable(),
});
export const branchListSchema = z.object({
  isGitRepo: z.boolean(),
  branches: z.array(branchEntrySchema),
  /** 本地分支多于上限时只列最近提交的那些 */
  truncated: z.boolean(),
});

export const hostContract = defineRpcContract({
  listListeners: {
    // 只读、可重放
    experimental_retryable: true,
    input: z.object({ root: z.string().min(1) }).strict(),
    output: z.discriminatedUnion("supported", [
      z.object({ supported: z.literal(true), listeners: z.array(listenerSchema) }),
      z.object({ supported: z.literal(false), reason: z.string() }),
    ]),
  },
  listContextFiles: {
    // 只读、可重放; 出错时返回空列表, 不抛
    experimental_retryable: true,
    input: z.object({ root: z.string().min(1) }).strict(),
    output: z.object({ isGitRepo: z.boolean(), files: z.array(contextFileSchema) }),
  },
  listBranches: {
    // 只读、可重放; 不是 git 仓库或 git 出错时返回空列表, 不抛
    experimental_retryable: true,
    input: z.object({ root: z.string().min(1) }).strict(),
    output: branchListSchema,
  },
  stopListener: {
    input: z
      .object({
        root: z.string().min(1),
        pid: z.number().int().nonnegative(),
        port: z.number().int().min(1).max(65535),
      })
      .strict(),
    output: z.object({ stopped: z.boolean(), message: z.string() }),
  },
});
