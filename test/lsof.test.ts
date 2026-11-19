import { test } from "node:test";
import assert from "node:assert/strict";
import {
  browserUrl,
  classifyOwnership,
  friendlyProcessName,
  isStoppable,
  isUnderRoot,
  parsePsTable,
  mergeListeners,
  parseCwds,
  parseListeners,
  splitAddress,
} from "../lib/lsof.ts";

const LISTEN_OUTPUT = [
  "p101",
  "cnode",
  "f23",
  "n*:5173",
  "f24",
  "n[::1]:5173",
  "p202",
  "cOrca",
  "f9",
  "n127.0.0.1:6768",
  "p303",
  "cpython3",
  "n127.0.0.1:8000->127.0.0.1:51000",
  "",
].join("\n");

const CWD_OUTPUT = [
  "p101",
  "fcwd",
  "n/Users/me/repo/apps/web",
  "p202",
  "fcwd",
  "n/",
  "",
].join("\n");

test("解析监听地址", () => {
  assert.deepEqual(splitAddress("*:3000"), { address: "*", port: 3000 });
  assert.deepEqual(splitAddress("[::1]:5173"), { address: "::1", port: 5173 });
  assert.equal(splitAddress("garbage"), null);
  assert.equal(splitAddress("*:70000"), null);
});

test("解析 lsof -F pcn, 跳过已建立连接", () => {
  const listeners = parseListeners(LISTEN_OUTPUT);
  assert.equal(listeners.length, 3);
  assert.deepEqual(listeners[0], { pid: 101, command: "node", address: "*", port: 5173 });
  assert.equal(listeners[2]!.command, "Orca");
});

test("合并同进程同端口的 IPv4/IPv6, 附上工作目录", () => {
  const merged = mergeListeners(parseListeners(LISTEN_OUTPUT), parseCwds(CWD_OUTPUT));
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0]!.addresses, ["*", "::1"]);
  assert.equal(merged[0]!.cwd, "/Users/me/repo/apps/web");
  assert.equal(merged[1]!.cwd, "/");
});

test("工作区归属判断", () => {
  assert.ok(isUnderRoot("/Users/me/repo", "/Users/me/repo/"));
  assert.ok(isUnderRoot("/Users/me/repo/apps/web", "/Users/me/repo"));
  assert.ok(!isUnderRoot("/Users/me/repo-other", "/Users/me/repo"));
  assert.ok(!isUnderRoot("/", "/Users/me/repo"));
  assert.ok(!isUnderRoot(null, "/Users/me/repo"));
  assert.ok(isUnderRoot("/private/var/folders/x", "/var/folders"));
});

test("进程显示名: 按版本号命名的二进制还原工具名", () => {
  const table = parsePsTable(PS_TABLE);
  assert.equal(table.get(4198)?.comm, "/Users/me/.local/share/claude/versions/2.1.325");
  assert.equal(friendlyProcessName("2.1.325", table.get(4198)!.comm), "claude 2.1.325");
  // 经 symlink 启动: ps 给启动名, lsof 给版本号
  assert.equal(friendlyProcessName("2.1.323", table.get(73339)!.comm), "claude 2.1.323");
  assert.equal(friendlyProcessName("node", table.get(44280)!.comm), "node");
  assert.equal(friendlyProcessName("Orca", null), "Orca");
});

// 进程树样本 (取自真实机器的形态, 路径已脱敏):
// 4185 bb 守护进程 → 4198 bb 线程里的 claude; 73131 zsh → 73339 claude (其他终端);
// 44280 launchd 拉起的常驻 node; 4198 claude → 5000 zsh → 5001 node (agent 起的开发服务);
// 4185 bb → 6000 zsh → 6001 python3 (bb 终端里起的服务)
const PS_TABLE = [
  "    1     0 /sbin/launchd",
  " 4185     1 /Applications/bb.app/Contents/MacOS/bb",
  " 4198  4185 /Users/me/.local/share/claude/versions/2.1.325",
  "73131 73108 /bin/zsh",
  "73339 73131 claude",
  "44280     1 /Users/me/.hermes/node/bin/node",
  " 5000  4198 /bin/zsh",
  " 5001  5000 node",
  " 6000  4185 /bin/zsh",
  " 6001  6000 /usr/bin/python3",
].join("\n");

test("端口归属: agent 本身与常驻进程不可停止, agent/终端起的子进程可停止", () => {
  const table = parsePsTable(PS_TABLE);
  const cases: [number, string, string, boolean][] = [
    [4198, "2.1.325", "agent", false],
    [73339, "2.1.323", "agent", false],
    [44280, "node", "other", false],
    [5001, "node", "agent-child", true],
    [6001, "python3", "terminal", true],
    [9999, "ghost", "other", false], // ps 里查不到的进程按 other 处理
  ];
  for (const [pid, command, kind, stoppable] of cases) {
    const ownership = classifyOwnership(pid, command, table);
    assert.equal(ownership.kind, kind, `pid ${pid}`);
    assert.equal(isStoppable(ownership), stoppable, `pid ${pid}`);
  }
  const child = classifyOwnership(5001, "node", table);
  assert.equal(child.kind === "agent-child" && child.agent, "claude");
});

test("浏览器地址", () => {
  assert.equal(browserUrl({ addresses: ["*"], port: 3000 }), "http://localhost:3000");
  assert.equal(browserUrl({ addresses: ["::1"], port: 5173 }), "http://[::1]:5173");
});

test("docker compose 端口: 只取发布到宿主机的映射, IPv4/IPv6 合并", async () => {
  const { parseDockerPorts, parseDockerRows } = await import("../lib/lsof.ts");
  assert.deepEqual(parseDockerPorts("0.0.0.0:21785->6379/tcp, [::]:21785->6379/tcp, 5432/tcp"), [{ port: 21785, address: "0.0.0.0" }]);
  const rows = parseDockerRows(
    ["app-db-1\t0.0.0.0:5433->5432/tcp\t/Users/me/repo\tdb", "stray\t0.0.0.0:80->80/tcp\t\t", ""].join("\n"),
  );
  assert.equal(rows.length, 1); // 不属于任何 compose 项目的容器无法归属, 丢弃
  assert.deepEqual(rows[0], { name: "app-db-1", workingDir: "/Users/me/repo", service: "db", ports: [{ port: 5433, address: "0.0.0.0" }] });
});

test("ports.json 命名: 坏文件与坏条目都不命名", async () => {
  const { parsePortLabels } = await import("../lib/lsof.ts");
  const labels = parsePortLabels(
    JSON.stringify({ ports: [{ port: 5173, label: " Web ", scheme: "https" }, { port: 99999, label: "x" }, { port: 3000 }, { port: 8080, label: "API", scheme: "ftp" }] }),
  );
  assert.deepEqual([...labels], [[5173, { label: "Web", scheme: "https" }], [8080, { label: "API", scheme: null }]]);
  assert.equal(parsePortLabels("not json").size, 0);
  assert.equal(parsePortLabels("{}").size, 0);
});

test("线程归属: 从 ps -E 的环境里取 BB_THREAD_ID", async () => {
  const { parsePsEnvThreads, threadIdFromEnv } = await import("../lib/lsof.ts");
  const out = [
    " 5001 node server.js PATH=/usr/bin BB_THREAD_ID=thr_bbbbbbbbbb HOME=/Users/me",
    " 5002 python3 -m http.server PATH=/usr/bin",
    " 5003 node x.js NOT_BB_THREAD_ID=thr_aaaaaaaaaa",
  ].join("\n");
  assert.deepEqual([...parsePsEnvThreads(out)], [[5001, "thr_bbbbbbbbbb"]]);
  assert.equal(threadIdFromEnv("A=1\0BB_THREAD_ID=thr_cccccccccc\0B=2"), "thr_cccccccccc");
  assert.equal(threadIdFromEnv("BB_THREAD_ID=bogus"), null);
});
