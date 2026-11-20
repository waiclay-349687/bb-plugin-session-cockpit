import { test } from "node:test";
import assert from "node:assert/strict";
import { environmentInfo, environmentKind, gitWorkState, repositoryName, splitPath, type EnvironmentInput, type ProjectInput } from "../lib/environment.ts";

// 字段取自本机 `bb environment list --json` 的真实样本 (路径已缩短)
const base: EnvironmentInput = {
  id: "env_x", projectId: "proj_r", name: null, path: "/w/reader", branchName: "main", isGitRepo: true, isWorktree: false, status: "ready", workspaceProvisionType: "unmanaged",
};
const reader: ProjectInput = { id: "proj_r", name: "reader", kind: "standard", gitRemoteUrl: "https://github.com/ReadBreakthrough/Reader-Monorepo.git" };
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
  assert.equal(repositoryName("https://github.com/ReadBreakthrough/Reader-Monorepo.git"), "ReadBreakthrough/Reader-Monorepo");
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
  const info = environmentInfo({ ...base, branchName: "feat/mobile", isWorktree: true, workspaceProvisionType: "managed-worktree" }, reader, host, 1);
  assert.deepEqual(
    { title: info.title, kind: info.kind, repository: info.repository, git: info.git, readiness: info.readiness },
    { title: "reader", kind: "worktree", repository: "ReadBreakthrough/Reader-Monorepo", git: { branch: "feat/mobile" }, readiness: "ready" },
  );
  const same = environmentInfo(base, { ...reader, name: "reader-monorepo" }, host, 1);
  assert.equal(same.repository, null);
  assert.equal(same.kind, "checkout");
});

test("非 git 目录、路径缺失、环境未就绪、多台机器", () => {
  const info = environmentInfo({ ...base, path: null, branchName: null, isGitRepo: false, workspaceProvisionType: null, status: "provisioning" }, { ...reader, gitRemoteUrl: null }, host, 2);
  assert.equal(info.kind, "directory");
  assert.equal(info.git, null);
  assert.equal(info.path, null);
  assert.equal(info.readiness, "preparing");
  assert.equal(environmentInfo({ ...base, status: "creating" }, reader, host, 1).readiness, "preparing");
  assert.equal(environmentInfo({ ...base, status: "error" }, reader, host, 1).readiness, "unavailable");
  assert.equal(environmentInfo({ ...base, status: "destroyed" }, reader, host, 1).readiness, "unavailable");
  assert.equal(info.hostName, "MacBook Pro");
  // 项目读取失败时仍能显示环境本身
  const orphan = environmentInfo({ ...base, name: "scratch" }, null, null, 3);
  assert.equal(orphan.title, "scratch");
  assert.equal(orphan.hostName, null);
  assert.equal(orphan.projectId, "proj_r");
});

test("git 工作区状态: 干净 / 改动数 / 分离头 / 读不到", () => {
  const row = (fileCount: number, checkout: object) => ({
    outcome: "available",
    workspace: { workingTree: { fileCount, hasUncommittedChanges: fileCount > 0 }, checkout },
  }) as Parameters<typeof gitWorkState>[0];
  assert.deepEqual(gitWorkState(row(0, { kind: "branch", branchName: "main" })), { kind: "clean", branch: "main", detached: false });
  assert.deepEqual(gitWorkState(row(3, { kind: "branch", branchName: "dev" })), { kind: "changed", count: 3, branch: "dev", detached: false });
  assert.deepEqual(gitWorkState(row(0, { kind: "detached", headSha: "abc" })), { kind: "clean", branch: null, detached: true });
  assert.deepEqual(gitWorkState(row(0, { kind: "unborn", branchName: "main" })), { kind: "clean", branch: "main", detached: false });
  assert.equal(gitWorkState({ outcome: "not_applicable" }), null);
  assert.equal(gitWorkState(null), null);
  assert.equal(gitWorkState(undefined), null);
});

test("路径拆成可截断的上级与完整的末段", () => {
  assert.deepEqual(splitPath("/Users/a/worktrees/thr_x-1/reader"), { head: "/Users/a/worktrees/thr_x-1/", tail: "reader" });
  assert.deepEqual(splitPath("/Users/a/reader/"), { head: "/Users/a/", tail: "reader" });
  assert.deepEqual(splitPath("/reader"), { head: "", tail: "/reader" });
  assert.deepEqual(splitPath("/"), { head: "", tail: "/" });
  assert.deepEqual(splitPath("C:\\work\\repo"), { head: "C:\\work\\", tail: "repo" });
});
