import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { discoverContextFiles } from "../host.ts";

test("扫描七个层级的字节数，模块和记忆仅取元数据", async () => {
  const home = await mkdtemp(join(tmpdir(), "cockpit-scan-"));
  try {
    const parent = join(home, "projects");
    const root = join(parent, "workspace");
    const paths = [
      ["global", join(home, ".codex", "AGENTS.md")],
      ["parent", join(parent, "AGENTS.md")],
      ["project", join(root, "AGENTS.md")],
      ["modules", join(root, "lib", "AGENTS.md")],
      ["local", join(root, "CLAUDE.local.md")],
      ["rules", join(root, ".claude", "rules", "guide.md")],
      ["memory", join(root, ".claude", "memory", "MEMORY.md")],
    ] as const;
    await writeFile(join(home, "shared.md"), "Shared rules");
    for (const [, path] of paths) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "@~/shared.md\n中文", "utf8");
    }
    const alias = join(root, "lib", "CLAUDE.md");
    await symlink(join(home, "shared.md"), alias);
    const result = await discoverContextFiles(root, new AbortController().signal, home);
    for (const [level, path] of paths) {
      const file = result.files.find(file => file.path === path);
      assert.equal(file?.level, level);
      assert.equal(file?.sizeBytes, Buffer.byteLength("@~/shared.md\n中文"));
      assert.equal(file?.imports.length, level === "modules" || level === "memory" ? 0 : 1);
    }
    assert.equal(result.files.find(file => file.path === alias)?.sizeBytes, Buffer.byteLength("Shared rules"));
    assert.match(result.files.find(file => file.path === alias)?.realPath ?? "", /\/shared\.md$/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
