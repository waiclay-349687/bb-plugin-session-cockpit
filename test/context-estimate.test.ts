import { test } from "node:test";
import assert from "node:assert/strict";
import { contextFileUsage, estimateCategories, messageActivity, messageEstimates as estimateMessages, observedFilePath, scanWindowActivity, shouldEstimate } from "../lib/context-estimate.ts";
import { fileUsageSummary, loadedEntries, type ContextFile } from "../lib/context-files.ts";

const scope = { kind: "turn", turnId: "turn-a" };
const event = (type: string, data: Record<string, unknown>) => ({ type, data, scope });
const item = (type: string, id: string, rest: Record<string, unknown>) => event("item/completed", { item: { type, id, ...rest } });
const file = (level: ContextFile["level"], name: string, sizeBytes = 40): ContextFile =>
  ({ level, name, sizeBytes, path: `/tmp/fixture/${level}/${name}`, dir: level === "modules" ? "features/sample" : "", imports: [], changed: false });

const messageEstimates = (events: Parameters<typeof messageActivity>[0]) => estimateMessages(messageActivity(events));
const fileEntries = (files: readonly ContextFile[], provider: string) => contextFileUsage(files, new Set(), null, provider).stats.entries.map(entry => ({ ...entry, id: entry.path }));

test("官方分类、未知窗口与等待首个快照的 Claude 跳过估算", () => {
  const official = [{ id: "prompt", label: "Prompt", kind: "used" as const, tokens: 1, entries: [] }];
  assert.equal(shouldEstimate("codex", 0, []), false);
  assert.equal(shouldEstimate("other", 20, official), false);
  assert.equal(shouldEstimate("claude-code", 20, []), false);
  assert.equal(shouldEstimate("codex", 20, []), true);
});

test("只计已接受的请求和终态 item，排除重复、子 agent、展示字段和附件编码", () => {
  const input = [{ type: "text", text: "中文" }, { type: "localFile", name: "a.md", sizeBytes: 200000 }, { type: "image", url: "x".repeat(8000) }];
  const cmd = item("commandExecution", "c", { command: "test", aggregatedOutput: "12345678", presentation: { title: "x".repeat(8000) } });
  const chronological = [
    event("client/turn/requested", { requestId: "old", initiator: "user", input }),
    event("client/turn/requested", { requestId: "ok", initiator: "user", input }),
    event("turn/input/accepted", { clientRequestId: "ok" }),
    item("userMessage", "echo", { content: input }),
    event("item/agentMessage/delta", { delta: "ignored" }),
    item("agentMessage", "answer", { text: "hello" }),
    item("agentMessage", "child", { text: "ignored", parentToolCallId: "parent" }),
    item("contextCompaction", "child-compact", { parentToolCallId: "parent" }),
    cmd, cmd,
  ];
  assert.deepEqual(messageEstimates(chronological.reverse()).map(e => [e.label, e.tokens]), [
    ["User messages", 2], ["Assistant messages", 2], ["Tool calls", 1], ["Tool results", 2], ["Attachments", 257],
  ]);
});

test("按压缩与清空边界回溯，兼容只有 userMessage 的旧事件", () => {
  const recent = item("userMessage", "u", { content: [{ type: "text", text: "abcd" }] });
  for (const boundary of [event("thread/compacted", {}), event("thread/context/cleared", {}), item("contextCompaction", "c", {})]) {
    assert.deepEqual(messageEstimates([recent, boundary, item("agentMessage", "older", { text: "older" })]),
      [{ id: "user", label: "User messages", tokens: 1 }]);
  }
});

test("工具结果只估文字和参数，大体积媒体编码不影响占比", () => {
  const entries = (size: number) => messageEstimates([item("toolCall", "call", {
    tool: "preview", arguments: { name: "page" },
    result: { content: [{ type: "image", data: "x".repeat(size) }, { type: "text", text: "ok" }] },
  })]);
  assert.deepEqual(entries(40000), entries(2));
  assert.deepEqual(entries(2).map(e => e.label), ["Tool calls", "Tool results"]);
});

test("只有同一 provider 的全局和项目根候选参与估算，Codex 根目录 override 优先", () => {
  const files = [file("global", "AGENTS.md"), file("project", "AGENTS.md", 200), file("project", "AGENTS.override.md"),
    file("global", "GEMINI.md"), file("rules", "instructions.md"), file("memory", "MEMORY.md"), file("modules", "AGENTS.md"),
    file("parent", "AGENTS.md"), file("local", "CLAUDE.local.md")];
  const categories = (provider: string) => estimateCategories(90, 100, [], fileEntries(files, provider));
  assert.deepEqual(categories("codex")[1].entries.map(e => e.label), ["Global · AGENTS.md", "Project · AGENTS.override.md"]);
  assert.deepEqual(categories("codex").map(c => c.tokens), [0, 20, 70, 10]);
  assert.deepEqual(categories("acp-antigravity-acp").map(c => c.tokens), [0, 10, 80, 10]);
  assert.deepEqual(categories("other").map(c => c.tokens), [0, 0, 90, 10]);
  assert.equal(loadedEntries({ breakdownEstimated: true, categories: categories("codex") }), null);
});

test("超预算按比例缩放至叶子项；空窗口、已超窗口和取整余数均守恒", () => {
  const messages = [{ id: "user", label: "User messages", tokens: 10 }, { id: "assistant", label: "Assistant messages", tokens: 20 }];
  const files = [file("project", "AGENTS.md")];
  for (let used = 0; used <= 51; used++) {
    const [msg, docs, residual, free] = estimateCategories(used, 50, messages, fileEntries(files, "codex"));
    assert.equal(msg.tokens + docs.tokens + residual.tokens, used);
    assert.equal(residual.tokens, Math.max(0, used - 40));
    assert.equal(free.tokens, Math.max(0, 50 - used));
    for (const group of [msg, docs]) {
      assert.equal(group.entries.reduce((sum, e) => sum + e.tokens, 0), group.tokens);
      assert.ok(group.entries.every(e => Number.isInteger(e.tokens) && e.tokens >= 0));
    }
    assert.ok(Math.abs(msg.entries[0].tokens - Math.min(used, 40) / 4) <= 0.5);
  }
  assert.equal(messages[0].tokens, 10);
});

test("命中文件时加到文件分类，减去对应结果，保留调用和其他工具结果", () => {
  const module = file("modules", "AGENTS.md", 80);
  const root = "/tmp/fixture";
  const events = [
    item("toolCall", "read", { status: "completed", tool: "mcp__files__read_file", arguments: { AbsolutePath: "modules/../modules/AGENTS.md" }, result: "x".repeat(80) }),
    item("toolCall", "unrelated", { status: "completed", tool: "read_file", arguments: { path: "unlisted.md" }, result: "xxxx" }),
    item("fileRead", "again", { status: "completed", path: module.path }),
  ];
  const paths = new Set(events.map(e => observedFilePath(e, root)).filter(path => path !== null));
  const { stats, accountedPaths } = contextFileUsage([module], paths, null, "codex");
  assert.deepEqual(stats.entries.map(e => [e.label, e.source, e.tokens]), [["features/sample/AGENTS.md", "read", 20]]);
  const activity = messageActivity(events, root);
  assert.equal(activity.entries.find(e => e.id === "results")?.tokens, 21);
  const messages = estimateMessages(activity, accountedPaths);
  assert.equal(messages.find(e => e.id === "results")?.tokens, 1);
  assert.ok((messages.find(e => e.id === "calls")?.tokens ?? 0) > 0);
  for (const used of [12, 100]) {
    const categories = estimateCategories(used, 100, messages, stats.entries.map(e => ({ ...e, id: e.path })));
    assert.equal(categories.filter(c => c.kind === "used").reduce((sum, c) => sum + c.tokens, 0), used);
    assert.equal(categories[1].tokens, categories[1].entries[0].tokens);
  }
});

test("适配有明确读取语义的成功事件，排除搜索、目录列表和不安全解释的命令", () => {
  const root = "/tmp/fixture";
  const path = `${root}/module/AGENTS.md`;
  const read = (type: string, data: Record<string, unknown>) => observedFilePath(item(type, "sample", { status: "completed", ...data }), root);
  assert.equal(read("fileRead", { cmd: 'cat -- "module/AGENTS.md"' }), path);
  assert.equal(read("commandExecution", { command: "cat AGENTS.md", cwd: `${root}/module`, exitCode: 0 }), path);
  assert.equal(read("commandExecution", { command: "/bin/zsh -c '/bin/cat module/AGENTS.md'", exitCode: 0 }), path);
  for (const tool of ["Read", "view_file", "mcp__filesystem__read_file"]) {
    assert.equal(read("toolCall", { tool, arguments: { target_file: "./module/AGENTS.md" } }), path);
  }
  assert.equal(read("toolCall", { tool: "read_file", arguments: { Path: path }, result: { isError: true } }), null);
  assert.equal(read("fileRead", { path, status: "failed" }), null);
  for (const command of ["ls module", "rg rules module/AGENTS.md", "git status", "cat module/*", "cat module/AGENTS.md | head", "cat \"$PATH\""]) {
    assert.equal(read("commandExecution", { command, exitCode: 0 }), null);
  }
});

test("新完结事件即时加入，保留消息上限外读取，压缩和清空重置缓存", async () => {
  const itemAt = (seq: number, path: string) => ({ seq, ...item("fileRead", String(seq), { status: "completed", path }) });
  const root = "/tmp/fixture";
  const records = [itemAt(1, "early/AGENTS.md"), { seq: 2, ...item("agentMessage", "a", { text: "abcd" }) }];
  const page = async (before?: number) => records.filter(e => before === undefined || e.seq < before).slice().reverse().slice(0, 2);
  const first = await scanWindowActivity(2, 2, page, root, 1);
  assert.ok(first.paths.has(`${root}/early/AGENTS.md`));
  records.push(itemAt(3, "later/AGENTS.md"));
  const updated = await scanWindowActivity(3, 2, page, root, 1, first);
  assert.deepEqual(updated.paths, new Set([`${root}/early/AGENTS.md`, `${root}/later/AGENTS.md`]));
  const repeat = await scanWindowActivity(3, 2, async () => { throw Error("cached"); }, root, 1, updated);
  assert.equal(repeat, updated);
  for (const type of ["thread/compacted", "thread/context/cleared"]) {
    records.push({ seq: 4, ...event(type, {}) }, itemAt(5, "fresh/AGENTS.md"));
    const reset = await scanWindowActivity(5, 2, page, root, 1, updated);
    assert.deepEqual(reset.paths, new Set([`${root}/fresh/AGENTS.md`]));
    records.splice(-2);
  }
});

test("同一个符号链接目标只归一次，官方 token 优先且不改写快照", () => {
  const module = { ...file("modules", "AGENTS.md", 800), realPath: "/private/tmp/fixture/shared/AGENTS.md" };
  const alias = { ...file("local", "CLAUDE.local.md"), realPath: module.realPath };
  const rules = file("rules", "coding.md", 52);
  const reads = new Set(["/tmp/fixture/shared/AGENTS.md", rules.path]);
  const official = [{ id: "file", label: module.realPath, tokens: 123 }];
  const { stats, accountedPaths } = contextFileUsage([module, alias, rules], reads, official, "claude-code");
  assert.deepEqual(stats.entries.map(e => [e.path, e.source, e.tokens]), [[module.path, "official", 123], [rules.path, "read", 13]]);
  assert.equal(accountedPaths.has(alias.path), true);
  assert.deepEqual(official, [{ id: "file", label: module.realPath, tokens: 123 }]);
  assert.deepEqual(fileUsageSummary(stats, 10_000), { count: "2/3", tokens: 136, ratio: 0.0136, estimated: true, observed: true });
  assert.equal(fileUsageSummary(stats, 0).ratio, null);
});
