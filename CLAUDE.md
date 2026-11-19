# bb-plugin-session-cockpit: bb 线程的会话驾驶舱插件（上下文 / 缓存 / 服务 / 脚本）
TypeScript 5.9 + React 19 + zod 4 + @get-bb/plugin-sdk 0.6.132（bb 0.49）+ Node 22 内置测试器

<directory>
lib/: 纯逻辑层（用量归一、lsof 解析、上下文文件的层级与分组、格式化、配色），无 IO，见 lib/CLAUDE.md
components/cockpit/: Cockpit 分区（桌面挂线程上下文卡片，手机与窄窗格挂横幅详情）、设置页、对 bb 宿主界面的样式修饰与自检，见 components/cockpit/CLAUDE.md
components/ui/: bb 脚手架 vendored 的 shadcn 基础组件
skills/session-cockpit/: 注入给 agent 的 CLI 用法说明
test/: 单测与真实线程样本（fixtures 只含用量类事件）
docs/: 交接说明 HANDOFF.md（现状、未验证项、取舍、踩过的坑）
</directory>

<config>
package.json: 插件清单（bb.server / bb.app / bb.host / branding）与 npm 脚本
rpc.ts: 前端 ↔ 后端 RPC 契约（前端需要运行时契约对象，故独立于 server.ts）
contract.ts: 后端 ↔ 宿主机 RPC 契约（listListeners / stopListener / listContextFiles）
server.ts: 后端入口；host.ts: 宿主入口（lsof 发现端口；git ls-files / git status 与读文件系统发现上下文文件，只读）；app.tsx: 前端注册
GLOSSARY.md: 领域词汇（上下文文件、层级、已加载 / 有改动、组 / 项），界面文案与代码命名以它为准
PLUGIN_OVERVIEW.md: 商店详情文案，与 bb.description 保持一致
</config>

<commands>
typecheck: npm run typecheck
lint: 无（项目未配置 linter）
test: npm test
build: npm run build（= bb plugin build）
全量: npm run check
</commands>

<compatibility>
无外部调用方；RPC 契约与 CLI 输出仅供本插件前端与 agent 使用，可自由演进，改动时同步 skills/session-cockpit/SKILL.md。
插件 kv 里的 `scripts:<projectId>` 是用户数据，改结构需兼容旧值（读取时 zod 校验，坏值回落空列表）。
本机偏好存 localStorage `bb-plugin-session-cockpit:prefs:v6`，改结构时升版本号（读不到 v6 时沿用 v5 / v4 里“隐藏了哪些分区”和界面修饰开关，但清掉旧的展开状态：v6 起默认全部收起）。
Progress 分区跨插件只读 `worktree-lineage` 插件的 `briefing` RPC（速览由那个插件写、存盘）；那个插件没装、停用或返回形状变了，分区自动隐藏，本插件其余功能不受影响。本插件从不触发速览生成。
桌面卡片依赖 bb 实验功能 `threadContextCard` 且卡片处于固定状态（`threadContextCard.pinned`）；手机与窄窗格走横幅，不依赖该实验。
L3 豁免（零适配逻辑的脚手架基础组件）：components/ui/button.tsx、components/ui/card.tsx、components/ui/checkbox.tsx、components/ui/dialog.tsx、components/ui/input.tsx、components/ui/icon.tsx、components/ui/motion.ts、components/ui/coarse-pointer-sizing.ts、components/ui/overlay-trigger.ts、components/ui/responsive-overlay.tsx、components/ui/hooks/use-compact-viewport.tsx、components/ui/hooks/use-media-query.ts、components/ui/hooks/use-pointer-coarse.ts、hooks/useBrowserDimmingModal.ts、lib/utils.ts、lib/portal-scope.ts
</compatibility>
