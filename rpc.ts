/**
 * [INPUT]: 依赖 @get-bb/plugin-sdk 的 defineRpcContract、zod, 以及 contract.ts 的 listenerSchema 与 contextFileSchema
 * [OUTPUT]: 对外提供 rpcContract 与 SessionSnapshot / ServersResult / ContextFilesResult / ProjectScript / SideChat 类型: 前端 ↔ 后端的 RPC 契约，含上下文文件的官方、启动估算和观测来源
 * [POS]: 插件根的前后端共享契约 (前端 experimental_useRpcQuery 需要运行时契约对象, 故不能留在 server.ts); 消费者: server.ts (注册 handler)、components/cockpit/data.ts (读取); 与 contract.ts 的边界: contract.ts 只管 server ↔ 宿主机
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { contextFileSchema, listenerSchema } from "./contract";

const threadInput = z.object({ threadId: z.string().min(1) }).strict();
const projectInput = z.object({ projectId: z.string().min(1) }).strict();
const nullableNumber = z.number().nullable();

const tokensSchema = z.object({
  uncachedInput: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  output: z.number(),
  reasoning: z.number(),
  prompt: z.number(),
  total: z.number(),
});


const fileSourceSchema = z.enum(["official", "read", "startup"]);
const fileUsageSchema = z.object({ path: z.string(), label: z.string(), tokens: z.number(), source: fileSourceSchema });

const categorySchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["used", "reserved", "free", "deferred"]),
  tokens: z.number(),
  entries: z.array(z.object({ id: z.string(), label: z.string(), tokens: z.number(), path: z.string().optional(), source: fileSourceSchema.optional() })),
});

const sessionSchema = z.object({
  threadId: z.string(),
  projectId: z.string(),
  providerId: z.string(),
  status: z.string(),
  running: z.boolean(),
  createdAt: z.number(),
  hostId: z.string().nullable(),
  environmentId: z.string().nullable(),
  environmentPath: z.string().nullable(),
  contextFiles: z.object({
    total: z.number(),
    basis: z.enum(["official", "estimated", "observed"]),
    entries: z.array(fileUsageSchema),
  }).nullable(),
  context: z
    .object({
      usedTokens: z.number(),
      windowTokens: z.number(),
      estimated: z.boolean(),
      model: z.string().nullable(),
      capturedAt: nullableNumber,
      autoCompactAtTokens: nullableNumber,
      categories: z.array(categorySchema),
      breakdownEstimated: z.literal(true).optional(),
      cost: z.object({ amount: z.number(), currency: z.string() }).nullable(),
      compactionOfferAt: nullableNumber,
    })
    .nullable(),
  tokens: z.object({
    semantics: z.enum(["exclusive", "inclusive", "unknown"]),
    lastTurn: tokensSchema.nullable(),
    session: tokensSchema.nullable(),
    updatedAt: nullableNumber,
    promptCacheTtlMs: nullableNumber,
  }),
  turns: z.object({
    completed: z.number(),
    workingMs: z.number(),
    activeSince: nullableNumber,
    lastCompletedAt: nullableNumber,
  }),
  connectors: z.array(
    z.object({
      name: z.string(),
      loadedTools: z.number(),
      deferredTools: z.number(),
      tokens: z.number(),
    }),
  ),
  generatedAt: z.number(),
});
export type SessionSnapshot = z.infer<typeof sessionSchema>;
export type SessionContext = NonNullable<SessionSnapshot["context"]>;
export type SessionCategory = SessionContext["categories"][number];
export type SessionTokens = NonNullable<SessionSnapshot["tokens"]["session"]>;


const serversSchema = z.discriminatedUnion("supported", [
  z.object({
    supported: z.literal(true),
    root: z.string(),
    servers: z.array(listenerSchema),
  }),
  z.object({ supported: z.literal(false), reason: z.string() }),
]);
export type ServersResult = z.infer<typeof serversSchema>;

export const scriptSchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string(),
  /** 运行后在 bb 里打开的地址 (T3 Code 的 Preview URL); 旧数据没有这个字段, 读取时补 null */
  previewUrl: z.string().nullable().default(null),
  createdAt: z.number(),
});
export type ProjectScript = z.infer<typeof scriptSchema>;

const sideChatSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: z.string(),
  updatedAt: z.number(),
});
export type SideChat = z.infer<typeof sideChatSchema>;

/** 线程工作区的上下文文件 (各层级的 CLAUDE.md、AGENTS.md、规则、自动记忆); 线程没有工作区时为空 */
const contextFilesSchema = z.object({
  hostId: z.string().nullable(),
  isGitRepo: z.boolean(),
  files: z.array(contextFileSchema),
});
export type ContextFilesResult = z.infer<typeof contextFilesSchema>;

export const rpcContract = defineRpcContract({
  contextFiles: {
    input: threadInput,
    output: contextFilesSchema,
    tags: ({ threadId }) => [`contextfiles:${threadId}`],
  },
  sideChats: {
    input: threadInput,
    output: z.object({ chats: z.array(sideChatSchema) }),
    tags: ({ threadId }) => [`sidechats:${threadId}`],
  },
  session: {
    input: threadInput,
    output: sessionSchema,
    tags: ({ threadId }) => [`thread:${threadId}`],
  },
  servers: {
    input: threadInput,
    output: serversSchema,
    tags: ({ threadId }) => [`servers:${threadId}`],
  },
  stopServer: {
    input: z
      .object({
        threadId: z.string().min(1),
        pid: z.number().int().nonnegative(),
        port: z.number().int().min(1).max(65535),
      })
      .strict(),
    output: z.object({ stopped: z.boolean(), message: z.string() }),
  },
  scripts: {
    input: projectInput,
    output: z.object({ scripts: z.array(scriptSchema) }),
    tags: ({ projectId }) => [`scripts:${projectId}`],
  },
  saveScript: {
    input: z
      .object({
        projectId: z.string().min(1),
        id: z.string().min(1).optional(),
        name: z.string().trim().min(1).max(60),
        command: z.string().trim().min(1).max(2000),
        previewUrl: z
          .string()
          .trim()
          .max(500)
          .regex(/^https?:\/\/\S+$/i, "Preview URL must start with http:// or https://")
          .nullable()
          .optional(),
      })
      .strict(),
    output: scriptSchema,
  },
  removeScript: {
    input: z.object({ projectId: z.string().min(1), id: z.string().min(1) }).strict(),
    output: z.object({ removed: z.boolean() }),
  },
});
