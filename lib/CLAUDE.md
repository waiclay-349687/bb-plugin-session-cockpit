# lib/
> L2 | 父级: ../CLAUDE.md

## 成员清单
i18n.ts: 成对的中英文 UI 词条、语言策略解析、分类与文件标签映射。
context-estimate.ts: 从 BB 完结事件追踪本窗口文件读取，按路径与宿主扫描关联；兜底分类复用文件归因并对齐 provider 总预算。
usage.ts: 用量领域核心，token 口径归一（按 totalTokens 恒等式判 exclusive/inclusive）、事件汇总（最新用量、回合计时）、上下文分类排序、MCP 连接器反推、缓存冷热推算
lsof.ts: 端口发现纯逻辑，解析 lsof/ps 输出、合并 IPv4/IPv6、工作区过滤、按进程树判定归属（agent / agent-child / terminal / other，仅 agent-child 与 terminal 可停止；docker 归属由 host.ts 标注且可停止）、从进程环境的 BB_THREAD_ID 取所属线程（思路来自 Hotspot 插件，MIT）、进程显示名还原（版本号命名的二进制 → 工具名）；docker compose 端口解析与 .bb/ports.json 端口命名（思路来自 Worktree Ports 插件，MIT）
context-files.ts: 上下文文件领域核心（词汇见 GLOSSARY.md）。发现侧：固定候选位置与要列的目录、自动记忆目录名（路径里的 / . _ 换成 -）、路径 → 层级（一个文件只属于一个层级）、git status --porcelain -z 解析（改名字段、未跟踪目录前缀、仓库子目录前缀换算）、@路径 导入解析（围栏与行内代码之外；“是不是文件”由调用方注入，本身不做 IO）。用量与展示侧：统一相对路径和符号链接别名，合并官方与观测文件状态，计算已加载数、token 与窗口占比，按层级分组、就地列哪些（超过 8 个只列已加载与有改动的）、弹层按顶层目录分组、行上的名字
environment.ts: 环境领域核心，环境类型（provision 类型优先：personal / managed-worktree；手动加入的 git worktree 也算 Worktree；其余按 isGitRepo 分项目目录 / 普通目录）、remote → owner/repo、仓库名与项目名相同时不重复、多于一台机器才写机器名、bb--git status 行 → 无改动 / n 项有改动、路径拆成可截断的上级与完整末段
format.ts: 显示格式化，token 紧凑写法、百分比、时长/倒计时、成本、TTL
cockpit-prefs.ts: 板块定义、浏览器偏好版本和迁移、顺序、语言覆写、显示参数规范与校验。
briefing-config.ts: Worktree Lineage 配置读写契约、输入范围与差量更新；progressLanguagePatch（Progress 板块改语言时同步给速览生成语言的补丁）。
progress-view.ts: briefingDisplay，Progress 显示什么：概括、阶段标题与细则原样给出（不论语言），只有字段为空才用占位字；收起时的阶段与完成数。
briefing-regenerate.ts: Worktree Lineage 的 regenerateBriefing 结果契约（只抄 ok / status，不认识的状态按失败）、canRegenerate（Progress 何时给按钮）与 regenerateNotice（结果 → 轻提示词条）。
palette.ts: 视觉映射，上下文分类 → 宿主 ANSI 主题色，用量阈值色调（可配置的警戒值默认 80%，95% 为危险值）
utils.ts / portal-scope.ts: 脚手架 vendored 工具（cn、portal 作用域），L3 豁免

## 边界
本模块负责: 无 IO 的计算与解析，可被前端、后端、宿主三端共用
本模块不负责: 调用 bb SDK、执行命令、读写存储
上游: 无（只依赖语言内置能力）
下游: server.ts、host.ts、components/cockpit/*、test/*

[PROTOCOL]: 变更时更新此文件,然后检查父级 CLAUDE.md
