import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBranches, defaultBranchName, environmentInfo, environmentKind, filterBranches, gitWorkState, parseWorktreeList, repositoryName, splitPath, tildePath, type EnvironmentInput, type ProjectInput } from "../lib/environment.ts";

// 字段取自本机 `bb environment list --json` 的真实样本 (路径已缩短)
const base: EnvironmentInput = {
  id: "env_x", projectId: "proj_n", name: null, path: "/w/notes", branchName: "main", isGitRepo: true, isWorktree: false, status: "ready", workspaceProvisionType: "unmanaged",
};
const notes: ProjectInput = { id: "proj_n", name: "notes", kind: "standard", gitRemoteUrl: "https://github.com/acme-labs/Notes-Monorepo.git" };
const personal: ProjectInput = { id: "proj_personal", name: "Personal", kind: "personal", gitRemoteUrl: null };
const host = { id: "host_a", name: "MacBook Pro" };

test("环境类型: provision 类型优先，手动加入的 git worktree 也算 Worktree", () => {
  assert.equal(environmentKind({ workspaceProvisionType: "personal", isWorktree: false, isGitRepo: false }), "personal");
  assert.equal(environmentKind({ workspaceProvisionType: "managed-worktree", isWorktree: true, isGitRepo: true }), "worktree");
  assert.equal(environmentKind({ workspaceProvisionType: "unmanaged", isWorktree: true, isGitRepo: true }), "worktree");
  assert.equal(environmentKind({ workspaceProvisionType: "unmanaged", isWorktree: false, isGitRepo: true }), "checkout");
  assert.equal(environmentKind({ workspaceProvisionType: null, isWorktree: false, isGitRepo: false }), "directory");
});

test("remote 地址归一成 owner/repo", () => {
  assert.equal(repositoryName("https://github.com/acme-labs/Notes-Monorepo.git"), "acme-labs/Notes-Monorepo");
  assert.equal(repositoryName("git@github.com:owner/repo.git"), "owner/repo");
  assert.equal(repositoryName("ssh://git@git.example.com:2222/group/sub/repo.git/"), "sub/repo");
  assert.equal(repositoryName("https://github.com/owner/repo"), "owner/repo");
  assert.equal(repositoryName(null), null);
  assert.equal(repositoryName("  "), null);
});

test("Personal workspace: 只有类型与路径，没有仓库和分支", () => {
  const info = environmentInfo(
    { ...base, path: "/ws/thr_a", branchName: null, isGitRepo: false, workspaceProvisionType: "personal" },
    personal, host, 1,
  );
  assert.equal(info.kind, "personal");
  assert.equal(info.title, null);
  assert.equal(info.repository, null);
  assert.equal(info.git, null);
  assert.equal(info.path, "/ws/thr_a");
  assert.equal(info.hostName, null);
});

test("managed worktree: 项目名、仓库、分支齐全；仓库名与项目名不同才另起一行", () => {
  const info = environmentInfo({ ...base, branchName: "feat/mobile", isWorktree: true, workspaceProvisionType: "managed-worktree" }, notes, host, 1);
  assert.deepEqual(
    { title: info.title, kind: info.kind, repository: info.repository, git: info.git, readiness: info.readiness },
    { title: "notes", kind: "worktree", repository: "acme-labs/Notes-Monorepo", git: { branch: "feat/mobile" }, readiness: "ready" },
  );
  const same = environmentInfo(base, { ...notes, name: "notes-monorepo" }, host, 1);
  assert.equal(same.repository, null);
  assert.equal(same.kind, "checkout");
});

test("非 git 目录、路径缺失、环境未就绪、多台机器", () => {
  const info = environmentInfo({ ...base, path: null, branchName: null, isGitRepo: false, workspaceProvisionType: null, status: "provisioning" }, { ...notes, gitRemoteUrl: null }, host, 2);
  assert.equal(info.kind, "directory");
  assert.equal(info.git, null);
  assert.equal(info.path, null);
  assert.equal(info.readiness, "preparing");
  assert.equal(environmentInfo({ ...base, status: "creating" }, notes, host, 1).readiness, "preparing");
  assert.equal(environmentInfo({ ...base, status: "error" }, notes, host, 1).readiness, "unavailable");
  assert.equal(environmentInfo({ ...base, status: "destroyed" }, notes, host, 1).readiness, "unavailable");
  assert.equal(info.hostName, "MacBook Pro");
  // 项目读取失败时仍能显示环境本身
  const orphan = environmentInfo({ ...base, name: "scratch" }, null, null, 3);
  assert.equal(orphan.title, "scratch");
  assert.equal(orphan.hostName, null);
  assert.equal(orphan.projectId, "proj_n");
});

test("git 工作区状态: 干净 / 改动数 / 分离头 / 读不到", () => {
  const row = (fileCount: number, checkout: object) => ({
    outcome: "available",
    workspace: { workingTree: { fileCount, hasUncommittedChanges: fileCount > 0 }, checkout },
  }) as Parameters<typeof gitWorkState>[0];
  assert.deepEqual(gitWorkState(row(0, { kind: "branch", branchName: "main" })), { kind: "clean", branch: "main", detached: false });
  assert.deepEqual(gitWorkState(row(3, { kind: "branch", branchName: "dev" })), { kind: "changed", count: 3, insertions: 0, deletions: 0, branch: "dev", detached: false });
  assert.deepEqual(gitWorkState(row(0, { kind: "detached", headSha: "abc" })), { kind: "clean", branch: null, detached: true });
  assert.deepEqual(gitWorkState(row(0, { kind: "unborn", branchName: "main" })), { kind: "clean", branch: "main", detached: false });
  assert.equal(gitWorkState({ outcome: "not_applicable" }), null);
  assert.equal(gitWorkState(null), null);
  assert.equal(gitWorkState(undefined), null);
});

test("路径拆成可截断的上级与完整的末段", () => {
  assert.deepEqual(splitPath("/Users/a/worktrees/thr_x-1/notes"), { head: "/Users/a/worktrees/thr_x-1/", tail: "notes" });
  assert.deepEqual(splitPath("/Users/a/notes/"), { head: "/Users/a/", tail: "notes" });
  assert.deepEqual(splitPath("/notes"), { head: "", tail: "/notes" });
  assert.deepEqual(splitPath("/"), { head: "", tail: "/" });
  assert.deepEqual(splitPath("C:\\work\\repo"), { head: "C:\\work\\", tail: "repo" });
});


test("路径把家目录缩成 ~，其余原样", () => {
  assert.equal(tildePath("/Users/alex/code/app"), "~/code/app");
  assert.equal(tildePath("/home/alex"), "~");
  assert.equal(tildePath("C:\\Users\\alex\\code"), "~\\code");
  assert.equal(tildePath("/opt/work/app"), "/opt/work/app");
  assert.equal(tildePath("/Users"), "/Users");
});

test("git worktree list --porcelain：每个目录与检出的分支，游离 HEAD 为 null", () => {
  const out = ["worktree /w/app", "HEAD 1111", "branch refs/heads/main", "", "worktree /w/app-feat", "HEAD 2222", "branch refs/heads/feat/oauth", "", "worktree /w/app-tmp", "HEAD 3333", "detached", ""].join("\n");
  assert.deepEqual(parseWorktreeList(out), [
    { path: "/w/app", branch: "main" },
    { path: "/w/app-feat", branch: "feat/oauth" },
    { path: "/w/app-tmp", branch: null },
  ]);
  assert.deepEqual(parseWorktreeList(""), []);
});

test("默认分支：远端 HEAD 优先，读不到时本地 main，再看 master", () => {
  assert.equal(defaultBranchName("origin/develop", ["main", "develop"]), "develop");
  assert.equal(defaultBranchName("", ["feat", "main"]), "main");
  assert.equal(defaultBranchName(null, ["master", "x"]), "master");
  assert.equal(defaultBranchName(null, ["x"]), null);
});

test("分支清单：当前置顶，其次默认，再是在别的 worktree 检出的，其余保持最近提交的顺序", () => {
  const branches = buildBranches({
    refs: ["fix/rate-limit", "feat/oauth", "main", "chore/deps", "spike/cache"],
    current: "chore/deps",
    defaultBranch: "main",
    worktrees: [{ path: "/w/app/", branch: "chore/deps" }, { path: "/w/app-oauth", branch: "feat/oauth" }],
    root: "/w/app",
  });
  assert.deepEqual(branches.map((b) => [b.name, b.current, b.isDefault, b.worktreePath]), [
    ["chore/deps", true, false, null],
    ["main", false, true, null],
    ["feat/oauth", false, false, "/w/app-oauth"],
    ["fix/rate-limit", false, false, null],
    ["spike/cache", false, false, null],
  ]);
});

test("分支搜索：空格分词、每个词都要出现、不分大小写；空查询给全部", () => {
  const branches = buildBranches({ refs: ["feat/OAuth-PKCE", "fix/rate-limit", "main"], current: "main", defaultBranch: "main", worktrees: [], root: "/w" });
  assert.deepEqual(filterBranches(branches, "oauth pkce").map((b) => b.name), ["feat/OAuth-PKCE"]);
  assert.deepEqual(filterBranches(branches, "  ").map((b) => b.name), ["main", "feat/OAuth-PKCE", "fix/rate-limit"]);
  assert.deepEqual(filterBranches(branches, "nothing"), []);
});

test("工作区状态带上新增 / 删除行数（读不到行数时为 0）", () => {
  const row = (workingTree: object) => ({ outcome: "available", workspace: { workingTree, checkout: { kind: "branch", branchName: "main" } } }) as Parameters<typeof gitWorkState>[0];
  assert.deepEqual(gitWorkState(row({ fileCount: 16, hasUncommittedChanges: true, insertions: 1202, deletions: 78 })), { kind: "changed", count: 16, insertions: 1202, deletions: 78, branch: "main", detached: false });
  assert.deepEqual(gitWorkState(row({ fileCount: 2, hasUncommittedChanges: true })), { kind: "changed", count: 2, insertions: 0, deletions: 0, branch: "main", detached: false });
  assert.deepEqual(gitWorkState(row({ fileCount: 0, hasUncommittedChanges: false })), { kind: "clean", branch: "main", detached: false });
});
