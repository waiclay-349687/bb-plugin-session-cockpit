# bb-plugin-session-cockpit: bb 线程的会话驾驶舱插件（环境 / 上下文 / 缓存 / 服务 / 脚本）
TypeScript 5.9 + React 19 + zod 4 + @get-bb/plugin-sdk 0.6.132（bb 0.49）+ Node 22 内置测试器

<directory>
lib/: 纯逻辑层（双语词典与格式化、环境信息归一、用量归一、基于 BB 事件与文件大小的上下文估算、lsof 解析、上下文文件的层级与分组、格式化、配色），无 IO，见 lib/CLAUDE.md
components/cockpit/: Cockpit 分区（桌面通过一个宿主分区挂入线程上下文卡片，手机和窄窗格挂横幅详情，共用九个可排序板块）、设置页、对 bb 宿主界面的样式修饰与自检，见 components/cockpit/CLAUDE.md
components/ui/: bb 脚手架 vendored 的 shadcn 基础组件
skills/session-cockpit/: 注入给 agent 的 CLI 用法说明
test/: 单测、合成估算用例与脱敏线程样本（fixtures 只含用量类事件）
docs/: 交接说明 HANDOFF.md（现状、未验证项、取舍、踩过的坑）
</directory>

<config>
package.json: 插件清单（bb.server / bb.app / bb.host / branding）与 npm 脚本
rpc.ts: 前端 ↔ 后端 RPC 契约（含 language 与 setLanguage、environment 环境信息），breakdownEstimated 标记插件估算的分类，contextFiles 记录文件统计及来源（前端需要运行时契约对象，故独立于 server.ts）
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
服务端 language 支持 auto / en / zh。浏览器本地存储仅用于初始化镜像，界面由 language RPC 持续同步；分类键和文件元数据保持原值。
插件 kv 里的 `scripts:<projectId>` 是用户数据，改结构需兼容旧值（读取时 zod 校验，坏值回落空列表）。
浏览器偏好存 localStorage `bb-plugin-session-cockpit:prefs:v7`，记录板块顺序、独立语言、显隐与展开状态、显示参数及界面优化。读取时从 v6 / v5 / v4 迁移，补齐缺少的板块并校验显示参数。
Environment 项跨插件只读 bb 内置 `bb--git` 插件的 `status` keyed RPC（只抄用到的字段）；读不到时只去掉"无改动 / n 项有改动"提示，分支回落到环境记录。
Progress 用板块有效语言显示速览，通过 `worktree-lineage` 的 `briefing` RPC 读已保存内容；用户点“重新生成”时调用对方的 `regenerateBriefing`（立即按当前配置重写一次，按返回的 status 用板块语言提示结果）。设置页通过 `briefingConfig` / `setBriefingConfig` 编辑该插件持有的生成配置。对方缺席或接口不兼容时显示配置不可用，其他设置继续工作。
桌面卡片依赖 bb 实验功能 `threadContextCard` 且卡片处于固定状态（`threadContextCard.pinned`）；手机与窄窗格走横幅，不依赖该实验。
L3 豁免（零适配逻辑的脚手架基础组件）：components/ui/button.tsx、components/ui/card.tsx、components/ui/checkbox.tsx、components/ui/dialog.tsx、components/ui/input.tsx、components/ui/icon.tsx、components/ui/motion.ts、components/ui/coarse-pointer-sizing.ts、components/ui/overlay-trigger.ts、components/ui/responsive-overlay.tsx、components/ui/hooks/use-compact-viewport.tsx、components/ui/hooks/use-media-query.ts、components/ui/hooks/use-pointer-coarse.ts、hooks/useBrowserDimmingModal.ts、lib/utils.ts、lib/portal-scope.ts
</compatibility>
