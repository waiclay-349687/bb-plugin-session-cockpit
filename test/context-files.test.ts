// 上下文文件的纯逻辑: 层级判定、自动记忆目录名、导入解析、git status 解析、已加载合并、汇总与分组。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  candidatePaths,
  changedMatcher,
  classifyPath,
  classifyRelative,
  compareRelative,
  extractImportTokens,
  fileLabel,
  groupByLevel,
  groupByTopDir,
  inlineSelection,
  listedDirs,
  loadedEntries,
  memorySlug,
  mergeLoaded,
  parentDirs,
  parseGitStatus,
  resolveImports,
  summarize,
  type ContextFile,
  type ContextFileView,
  type ContextLevel,
} from "../lib/context-files.ts";

const HOME = "/Users/ada";
const ROOT = "/Users/ada/code/shop";
const env = { root: ROOT, home: HOME };

const file = (path: string, extra: Partial<ContextFile> = {}): ContextFile => {
  const kind = classifyPath(path, env);
  assert.ok(kind, `not a context file: ${path}`);
  return { path, ...kind, changed: false, imports: [], ...extra };
};
const view = (path: string, extra: Partial<ContextFileView> = {}): ContextFileView => ({ ...file(path), loaded: null, tokens: null, ...extra });
const levelOf = (path: string): ContextLevel | null => classifyPath(path, env)?.level ?? null;

test("memorySlug 把 / . _ 都换成 -", () => {
  // 真实样本: bb 个人工作区的自动记忆目录名
  assert.equal(
    memorySlug("/Users/ada/.bb/plugins/environment-personal-workspace/host-data/workspaces/thr_abcdefghij"),
    "-Users-ada--bb-plugins-environment-personal-workspace-host-data-workspaces-thr-abcdefghij",
  );
  assert.equal(memorySlug("/Users/ada/code/shop/"), "-Users-ada-code-shop");
});

test("classifyRelative: 工作区内一个文件只属于一个层级", () => {
  assert.equal(classifyRelative("CLAUDE.md"), "project");
  assert.equal(classifyRelative("AGENTS.md"), "project");
  assert.equal(classifyRelative("AGENTS.override.md"), "project");
  assert.equal(classifyRelative("GEMINI.md"), "project");
  assert.equal(classifyRelative(".claude/CLAUDE.md"), "project");
  // 根目录的 CLAUDE.local.md 是本地私有, 不是项目
  assert.equal(classifyRelative("CLAUDE.local.md"), "local");
  assert.equal(classifyRelative("packages/core/CLAUDE.local.md"), "local");
  assert.equal(classifyRelative("packages/core/CLAUDE.md"), "modules");
  assert.equal(classifyRelative("apps/web/AGENTS.md"), "modules");
  assert.equal(classifyRelative(".github/GEMINI.md"), "modules");
  assert.equal(classifyRelative(".claude/rules/testing.md"), "rules");
  assert.equal(classifyRelative(".claude/memory/notes.md"), "memory");
  // 文件名要精确匹配; 规则只认直接放在目录下的 md
  assert.equal(classifyRelative("docs/MY-CLAUDE.md"), null);
  assert.equal(classifyRelative("docs/claude.md"), null);
  assert.equal(classifyRelative("packages/core/AGENTS.override.md"), null);
  assert.equal(classifyRelative(".claude/rules/nested/deep.md"), null);
  assert.equal(classifyRelative(".claude/rules/data.json"), null);
  assert.equal(classifyRelative("README.md"), null);
});

test("classifyPath: 工作区外按绝对位置判层级", () => {
  assert.equal(levelOf("/Users/ada/.claude/CLAUDE.md"), "global");
  assert.equal(levelOf("/Users/ada/.codex/AGENTS.md"), "global");
  assert.equal(levelOf("/Users/ada/.gemini/GEMINI.md"), "global");
  assert.equal(levelOf("/Users/ada/.claude/rules/style.md"), "rules");
  assert.equal(levelOf("/Users/ada/.claude/projects/-Users-ada-code-shop/memory/MEMORY.md"), "memory");
  // 别的工作区的自动记忆不算
  assert.equal(levelOf("/Users/ada/.claude/projects/-Users-ada-code-other/memory/MEMORY.md"), null);
  assert.equal(levelOf("/Users/ada/code/CLAUDE.md"), "parent");
  assert.equal(levelOf("/Users/ada/CLAUDE.local.md"), "parent");
  // home 之上不再找; 不相干的目录不算上级
  assert.equal(levelOf("/Users/CLAUDE.md"), null);
  assert.equal(levelOf("/Users/ada/other/CLAUDE.md"), null);
  assert.equal(levelOf("/Users/ada/code/shop/CLAUDE.md"), "project");
  assert.equal(levelOf("/Users/ada/code/shop/apps/web/CLAUDE.md"), "modules");
  assert.equal(levelOf("/Users/ada/code/shop/src/index.ts"), null);
});

test("classifyPath: dir 是显示用的目录", () => {
  assert.deepEqual(classifyPath("/Users/ada/.claude/CLAUDE.md", env), { level: "global", name: "CLAUDE.md", dir: "~/.claude" });
  assert.deepEqual(classifyPath("/Users/ada/code/CLAUDE.md", env), { level: "parent", name: "CLAUDE.md", dir: "~/code" });
  assert.deepEqual(classifyPath(`${ROOT}/CLAUDE.md`, env), { level: "project", name: "CLAUDE.md", dir: "" });
  assert.deepEqual(classifyPath(`${ROOT}/apps/web/AGENTS.md`, env), { level: "modules", name: "AGENTS.md", dir: "apps/web" });
});

test("parentDirs: 由近到远, 到 home 为止; 不在 home 下时到 / 为止, 最多 12 层", () => {
  assert.deepEqual(parentDirs(ROOT, HOME), ["/Users/ada/code", "/Users/ada"]);
  assert.deepEqual(parentDirs("/srv/app/site", HOME), ["/srv/app", "/srv", "/"]);
  assert.deepEqual(parentDirs(HOME, HOME), ["/Users", "/"]);
  assert.equal(parentDirs(`/${Array.from({ length: 20 }, (_, i) => `d${i}`).join("/")}`, HOME).length, 12);
});

test("compareRelative: 父目录排在子目录之前, 文件名不干扰目录顺序", () => {
  const paths = ["apps/api/src/auth/CLAUDE.md", "apps/api/test/CLAUDE.md", "apps/CLAUDE.md", "apps/api/src/CLAUDE.md", "apps/api/CLAUDE.md", "apps/api/AGENTS.md", "apps-old/CLAUDE.md"];
  assert.deepEqual([...paths].sort(compareRelative), [
    "apps/CLAUDE.md",
    "apps/api/AGENTS.md",
    "apps/api/CLAUDE.md",
    "apps/api/src/CLAUDE.md",
    "apps/api/src/auth/CLAUDE.md",
    "apps/api/test/CLAUDE.md",
    "apps-old/CLAUDE.md",
  ]);
});

test("候选位置都能被判回一个层级 (发现与判定同一份规则)", () => {
  for (const path of candidatePaths(ROOT, HOME)) assert.ok(classifyPath(path, env), path);
  for (const dir of listedDirs(ROOT, HOME)) assert.ok(classifyPath(`${dir}/note.md`, env), dir);
  // home 下的 .claude 属于全局, 不会被当成上级目录的文件
  assert.equal(candidatePaths(ROOT, HOME).filter((path) => path === "/Users/ada/.claude/CLAUDE.md").length, 1);
});

test("extractImportTokens: 只认代码块与行内代码之外的 @token", () => {
  const text = [
    "@RTK.md",
    "See @docs/guide.md, and @~/notes/me.md.",
    "mail ada@example.com and `@inline/code.md` stay out",
    "```sh",
    "npm i @get-bb/plugin-sdk",
    "@fenced.md",
    "```",
    "~~~",
    "@tilde-fenced.md",
    "~~~",
    "(@paren.md) \"@quoted.md\"",
    "@RTK.md again",
  ].join("\n");
  assert.deepEqual(extractImportTokens(text), ["RTK.md", "docs/guide.md", "~/notes/me.md"]);
});

test("resolveImports: 只有落到真实文件的才算导入, npm 包名不算", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ctx-files-"));
  try {
    mkdirSync(join(dir, "home/notes"), { recursive: true });
    mkdirSync(join(dir, "ws/docs"), { recursive: true });
    mkdirSync(join(dir, "ws/get-bb"), { recursive: true });
    writeFileSync(join(dir, "ws/RTK.md"), "rtk");
    writeFileSync(join(dir, "ws/docs/guide.md"), "guide");
    writeFileSync(join(dir, "home/notes/me.md"), "me");
    const importer = join(dir, "ws/CLAUDE.md");
    const text = [
      "@RTK.md",
      "Built on @get-bb/plugin-sdk and @types/node.",
      "@docs/guide.md then @./docs/../RTK.md (same file twice)",
      "@~/notes/me.md",
      "@docs",
      "@missing.md",
      "@CLAUDE.md",
    ].join("\n");
    writeFileSync(importer, text);
    const isFile = (path: string) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    };
    const imports = await resolveImports(text, importer, join(dir, "home"), isFile);
    assert.deepEqual(imports, [
      { path: join(dir, "ws/RTK.md"), name: "RTK.md" },
      { path: join(dir, "ws/docs/guide.md"), name: "guide.md" },
      { path: join(dir, "home/notes/me.md"), name: "me.md" },
    ]);
    // 包名的 scope 目录就算真的存在, 也不是普通文件
    assert.deepEqual(await resolveImports("@get-bb/plugin-sdk\n@get-bb", importer, join(dir, "home"), isFile), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseGitStatus: -z 输出, 改名多一个字段, 忽略的不算, 删除的单列", () => {
  const output = [" M apps/web/CLAUDE.md", "?? packages/new/", "R  docs/NEW.md", "docs/OLD.md", "A  AGENTS.md", " D packages/gone/CLAUDE.md", "D  removed/CLAUDE.md", "!! node_modules/", ""].join("\0");
  const status = parseGitStatus(output);
  assert.deepEqual(status.changed, ["apps/web/CLAUDE.md", "packages/new/", "docs/NEW.md", "AGENTS.md"]);
  assert.deepEqual(status.deleted, ["packages/gone/CLAUDE.md", "removed/CLAUDE.md"]);
  const isChanged = changedMatcher(status);
  assert.equal(isChanged("apps/web/CLAUDE.md"), true);
  assert.equal(isChanged("AGENTS.md"), true);
  // 整个目录未跟踪时 git 只报目录, 里面的文件按前缀算
  assert.equal(isChanged("packages/new/CLAUDE.md"), true);
  assert.equal(isChanged("packages/newer/CLAUDE.md"), false);
  assert.equal(isChanged("docs/OLD.md"), false);
  assert.equal(isChanged("CLAUDE.md"), false);
});

test("parseGitStatus: 工作区根是仓库子目录时按前缀换算", () => {
  const output = [" M packages/app/CLAUDE.md", "?? packages/app/src/new/", " M packages/other/CLAUDE.md", " M README.md", ""].join("\0");
  assert.deepEqual(parseGitStatus(output, "packages/app/"), { changed: ["CLAUDE.md", "src/new/"], deleted: [] });
});

test("loadedEntries: 没有明细 = 不知道, 有明细但没有 Memory files = 一个都没加载", () => {
  assert.equal(loadedEntries(null), null);
  assert.equal(loadedEntries(undefined), null);
  assert.equal(loadedEntries({ categories: [] }), null);
  assert.deepEqual(loadedEntries({ categories: [{ label: "Messages", entries: [] }] }), []);
  assert.deepEqual(loadedEntries({ categories: [{ label: "Memory files", entries: [{ label: "/a/CLAUDE.md", tokens: 12 }] }] }), [{ label: "/a/CLAUDE.md", tokens: 12 }]);
});

test("mergeLoaded: 三种状态, 按绝对路径匹配 (/tmp 与 /private/tmp 算同一个)", () => {
  const files = [file("/Users/ada/.claude/CLAUDE.md"), file(`${ROOT}/CLAUDE.md`), file(`${ROOT}/apps/web/CLAUDE.md`)];
  assert.deepEqual(mergeLoaded(files, null).map((f) => [f.loaded, f.tokens]), [[null, null], [null, null], [null, null]]);
  const merged = mergeLoaded(files, [{ label: `${ROOT}/CLAUDE.md`, tokens: 4605 }, { label: "/Users/ada/.claude/CLAUDE.md", tokens: 7397 }]);
  assert.deepEqual(merged.map((f) => [f.loaded, f.tokens]), [[true, 7397], [true, 4605], [false, null]]);

  const tmp = { root: "/tmp/ws", home: HOME };
  const tmpFile: ContextFile = { path: "/tmp/ws/CLAUDE.md", ...classifyPath("/tmp/ws/CLAUDE.md", tmp)!, changed: false, imports: [] };
  assert.equal(mergeLoaded([tmpFile], [{ label: "/private/tmp/ws/CLAUDE.md", tokens: 9 }])[0]!.loaded, true);
  assert.equal(mergeLoaded([{ ...tmpFile, path: "/private/tmp/ws/CLAUDE.md" }], [{ label: "/tmp/ws/CLAUDE.md", tokens: 9 }])[0]!.tokens, 9);
});

test("summarize / groupByLevel: 导入不计数, 不知道已加载时是 null 而不是 0, 空层级不出现", () => {
  const files = [
    file("/Users/ada/.claude/CLAUDE.md", { imports: [{ path: "/Users/ada/.claude/RTK.md", name: "RTK.md" }] }),
    file(`${ROOT}/CLAUDE.md`),
    file(`${ROOT}/AGENTS.md`, { changed: true }),
    file(`${ROOT}/apps/web/CLAUDE.md`, { changed: true }),
  ];
  const unknown = mergeLoaded(files, null);
  assert.deepEqual(summarize(unknown), { total: 4, loaded: null, changed: 2 });
  const known = mergeLoaded(files, [{ label: `${ROOT}/CLAUDE.md`, tokens: 100 }]);
  assert.deepEqual(summarize(known), { total: 4, loaded: 1, changed: 2 });
  const groups = groupByLevel(known);
  assert.deepEqual(groups.map((g) => [g.level, g.label, g.total, g.loaded, g.changed]), [
    ["global", "Global", 1, 0, 0],
    ["project", "Project", 2, 1, 1],
    ["modules", "Modules", 1, 0, 1],
  ]);
  assert.equal(groupByLevel(unknown)[1]!.loaded, null);
});

test("inlineSelection: 不超过 8 个全列; 更多时只列已加载与有改动的, 最多 8 个", () => {
  const modules = Array.from({ length: 30 }, (_, i) => view(`${ROOT}/pkg${String(i).padStart(2, "0")}/CLAUDE.md`, { loaded: false }));
  const few = groupByLevel(modules.slice(0, 8))[0]!;
  assert.deepEqual(inlineSelection(few), { files: few.files, showAll: false });

  const quiet = groupByLevel(modules)[0]!;
  assert.deepEqual(inlineSelection(quiet), { files: [], showAll: true });

  modules[20]!.changed = true;
  modules[5]!.loaded = true;
  const some = inlineSelection(groupByLevel(modules)[0]!);
  assert.deepEqual(some.files.map((f) => f.dir), ["pkg05", "pkg20"]);
  assert.equal(some.showAll, true);

  for (const module of modules) module.changed = true;
  assert.equal(inlineSelection(groupByLevel(modules)[0]!).files.length, 8);
});

test("inlineSelection: 自动记忆把 MEMORY.md 放最前", () => {
  const dir = "/Users/ada/.claude/projects/-Users-ada-code-shop/memory";
  const memory = ["alpha.md", "MEMORY.md", "beta.md"].map((name) => view(`${dir}/${name}`, { loaded: false }));
  assert.deepEqual(inlineSelection(groupByLevel(memory)[0]!).files.map((f) => f.name), ["MEMORY.md", "alpha.md", "beta.md"]);

  const many = [...Array.from({ length: 10 }, (_, i) => view(`${dir}/note-${i}.md`, { loaded: false })), view(`${dir}/MEMORY.md`, { loaded: true, tokens: 414 })];
  many[3]!.loaded = true;
  const picked = inlineSelection(groupByLevel(many)[0]!);
  assert.deepEqual(picked.files.map((f) => f.name), ["MEMORY.md", "note-3.md"]);
  assert.equal(picked.showAll, true);
});

test("groupByTopDir: 按文件数降序, 一两个文件的顶层目录并进末尾的 other", () => {
  const paths = [
    ...["a", "b", "c", "d"].map((n) => `apps/${n}/CLAUDE.md`),
    ...["x", "y", "z"].map((n) => `packages/${n}/CLAUDE.md`),
    ...["i", "j", "k"].map((n) => `docs/${n}/CLAUDE.md`),
    "skills/one/CLAUDE.md",
    "skills/two/CLAUDE.md",
    "bin/CLAUDE.md",
  ];
  const groups = groupByTopDir(paths.map((rel) => view(`${ROOT}/${rel}`)));
  assert.deepEqual(groups.map((g) => [g.name, g.files.length]), [["apps", 4], ["docs", 3], ["packages", 3], ["other", 3]]);
  assert.deepEqual(groups[3]!.files.map((f) => f.dir), ["skills/one", "skills/two", "bin"]);
  // 没有小组时不出现 other
  assert.deepEqual(groupByTopDir(paths.slice(0, 4).map((rel) => view(`${ROOT}/${rel}`))).map((g) => g.name), ["apps"]);
});

test("fileLabel: 模块写目录路径, 其余写文件名", () => {
  const label = (path: string) => fileLabel(file(path));
  assert.deepEqual(label(`${ROOT}/packages/core/src/pages/CLAUDE.md`), { text: "packages/core/src/pages", suffix: null });
  assert.deepEqual(label(`${ROOT}/packages/core/AGENTS.md`), { text: "packages/core", suffix: "AGENTS.md" });
  assert.deepEqual(label(`${ROOT}/packages/core/CLAUDE.local.md`), { text: "packages/core", suffix: null });
  assert.deepEqual(label(`${ROOT}/CLAUDE.local.md`), { text: "CLAUDE.local.md", suffix: null });
  assert.deepEqual(label(`${ROOT}/CLAUDE.md`), { text: "CLAUDE.md", suffix: null });
  assert.deepEqual(label(`${ROOT}/.claude/CLAUDE.md`), { text: ".claude/CLAUDE.md", suffix: null });
  assert.deepEqual(label("/Users/ada/code/AGENTS.md"), { text: "code/AGENTS.md", suffix: null });
  assert.deepEqual(label("/Users/ada/CLAUDE.md"), { text: "~/CLAUDE.md", suffix: null });
  assert.deepEqual(label("/Users/ada/.codex/AGENTS.md"), { text: "AGENTS.md", suffix: "~/.codex" });
  assert.deepEqual(label("/Users/ada/.claude/rules/style.md"), { text: "style.md", suffix: "~/.claude" });
  assert.deepEqual(label(`${ROOT}/.claude/rules/style.md`), { text: "style.md", suffix: null });
  assert.deepEqual(label("/Users/ada/.claude/projects/-Users-ada-code-shop/memory/MEMORY.md"), { text: "MEMORY.md", suffix: null });
  assert.deepEqual(label(`${ROOT}/.claude/memory/notes.md`), { text: "notes.md", suffix: ".claude" });
});
