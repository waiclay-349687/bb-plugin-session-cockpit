import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCategories, messageEstimates, shouldEstimate } from "../lib/context-estimate.ts";
import { loadedEntries, type ContextFile } from "../lib/context-files.ts";

const scope = { kind: "turn", turnId: "turn-a" };
const event = (type: string, data: Record<string, unknown>) => ({ type, data, scope });
const item = (type: string, id: string, rest: Record<string, unknown>) => event("item/completed", { item: { type, id, ...rest } });
const file = (level: ContextFile["level"], name: string, sizeBytes = 40): ContextFile =>
  ({ level, name, sizeBytes, path: name, dir: "", imports: [], changed: false });

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
  const categories = (provider: string) => estimateCategories(90, 100, [], provider, files);
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
    const [msg, docs, residual, free] = estimateCategories(used, 50, messages, "codex", files);
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
