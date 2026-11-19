# components/cockpit/
> L2 | 父级: ../../CLAUDE.md

## 成员清单
cockpit.tsx: 组合层。GROUPS 是分组的唯一真相源（Progress / Usage（Context、Session）/ Workspace（Servers、Scripts、Context files、Connectors、Side chats），组的顺序 = 重要程度），CockpitGroup 渲染一组里的各项（桌面卡片：app.tsx 把每组注册成 bb 卡片的一个分区，组名和分隔线由 bb 画），Cockpit 渲染全部分组并自己画组名与分隔线（横幅详情用，没有内容的组用 :has 整组隐藏）；SectionProps
data.ts: 数据入口，useSession/useSideChats/useScripts（experimental_useRpcQuery，服务端失效刷新）、useServers 与 useContextFiles（挂载取一次，项展开且页面可见时 30s 重取，共用内部的 usePollWhile；refetch 经 ref 取，不进 effect 依赖；上下文文件另在回合结束时由服务端失效刷新）、useNow
prefs.ts: 本机偏好（localStorage v6，读不到时从 v5 / v4 迁移（保留隐藏项与样式开关，清掉展开状态） + useSyncExternalStore），SECTION_DEFS 是分区清单与顺序的唯一真相源，open 记录展开着的项（默认全部收起）、hostStyles 记录界面修饰开关
rows.tsx: 行原语，SectionRow（一项一行：图标或 leading + 名称 + 摘要 + 箭头，常规字重；priority="label" 时名称可截断；带 data-cockpit-item 供分组判断有无内容）、SectionBody（第二层容器：分区展开后的全部内容缩进到“分区名称”那条线上，图标留在左侧的槽里，不画引导线；层级的画法只此一处，所有分区都用它）、Collapse（grid 0fr↔1fr + 淡入淡出，200ms，收起播完才卸载，尊重减少动态效果）、CardRow（quietMenu：菜单箭头悬停才出现，用于成列的文件行；stat 读数行：名称灰、数值正文色，不带图标；条目行相反；照抄原生 26px/12px 规格、触屏 36px、整行不缩放；行体主操作 + 右侧箭头菜单两个点击区；priority 决定放不下时谁截断）、MenuItem、MenuConfirmItem（两步确认：第一次选中不关菜单、文案变 Confirm，确认文案不长于原文案）、MoreRow、Meter、Hint、Dot
progress-section.tsx: Progress 组里唯一的一项：跨插件只读 worktree-lineage 的 briefing RPC（契约只抄读到的字段，解析失败即隐藏）。收起 = 一行：当前阶段的标记与名称（没有进行中的就取最后一个没放弃的）+ 完成数 n/m；点开 = 一句话概括 + 完整的阶段轨道（每个阶段带结论）+ 速览落后时一句 Updates when this turn ends。不显示 Now / Next / Needs you（用户明确不要）。还没有速览时是一行说明。重读时机：本轮是否在跑、已完成轮数变化时读一次，转为空闲后 6s / 15s / 30s 各补读一次（那边写速览要 4-15 秒）
context-section.tsx: Context 分区三层：摘要行 → 分段条 + 80% 提示 + 分类明细 + 两步确认 CompactButton → 有条目的分类就地展开前 8 项，更多时 EntriesDialog（桌面居中弹层、手机底部抽屉，可过滤，记忆文件是 FileLink 可点开预览）；CompactButton 供 usage-section 复用
usage-section.tsx: Usage 组里的 Session 项：摘要（本会话 token + 缓存状态）→ Prompt 缓存（含变冷提示、将过期时带 CompactButton 的提示）、工作时长、成本、Token 明细；展开内容全部是 stat 读数行，倒计时与轮数等附注再退后一档；Token 明细默认收成一行 Tokens（总量 + 缓存命中率），点开才列出其余三项
context-files-section.tsx: Workspace 组里的 Context files 项（词汇见 GLOSSARY.md）：服务端 contextFiles RPC 给出工作区的上下文文件（层级、有无改动、导入），与会话快照里上下文明细的 Memory files 条目合并出“已加载”（唯一依据；没有明细时是“不知道”，不画已加载标记）。三层：收起一行（`3 loaded · 80`，不知道时只写总数）→ 每个有文件的层级一行（Global / Parent / Project / Modules / Local / Rules / Memory：个数、已加载数、有改动的 M、箭头；层级的展开状态只留在组件里）→ 层级的文件（行体在 bb 的文件面板里预览，行尾菜单 Open in panel / Open in editor（能打开时才有）/ Copy path；已加载 = token 数 + 绿点，有改动 = 橙色 M；导入紧贴在导入者下面再缩进一格、前缀 ↳；模块写目录路径，放不下时从中间省略）。一个层级超过 8 个文件时只就地列已加载与有改动的（自动记忆的 MEMORY.md 恒在最前，最多 8 个），其余进 `All N · search` 弹层：模块按顶层目录分组（按个数降序，一两个文件的并进 other），可按路径过滤，点一项预览并关闭。没有任何上下文文件时返回 null
list-sections.tsx: Servers（本线程的可停止服务在前，agent 会话端口与其他线程的服务折叠并标 Other thread；agent-child / terminal / docker 可停止；行体打开、菜单里打开/复制/停止）/ Scripts（行体运行、可带预览地址自动打开；菜单里运行/预览/复制/编辑/删除）/ Connectors / Side chats（有才显示、行体分屏打开、菜单改名），各自带摘要行
compact.tsx: 横幅入口，SessionSegmentSummary（摘要即开关）与 SessionSegmentDetails（横幅下方展开 Cockpit，限高 50dvh）；手机与窄窗格上的唯一入口
host-styles.ts: 对 bb 宿主界面的全部样式改动（内容脚本注入，与主题无关）：卡片出入场与对话区平滑让位、历史导航条不被挤掉、卡片上限从 36rem 提到 54rem、在会话之间切换时卡片不重播入场（导航发生且卡片开着时在 <html> 上打 0.7 秒标记，期间新卡片跳过过渡）、桌面箭头光标（链接留手形、正文保留文字光标）；自带七项结构自检（HOOKS，含"正文不许变箭头"的反向自检），失效时 toast 提醒并给修复指令
settings-section.tsx: 插件设置页，ChooseDetailsSettings（分区开关、重置）与 HostStylesSettings（宿主样式开关、开关后立即复查、自检结论含 Off、复制修复指令）

## 边界
本模块负责: Cockpit 内容（桌面在线程上下文卡片、手机与窄窗格在横幅详情）、设置页的渲染与交互、对 bb 宿主界面的样式修饰
本模块不负责: 数据计算（在 lib/）、数据获取实现（在 server.ts / host.ts）、slot 注册（在 app.tsx）
上游: rpc.ts（契约）、contract.ts（ListenerInfo 类型）、lib/*（含 lib/context-files.ts 的层级与分组逻辑）、@get-bb/plugin-sdk/app、components/ui/*、worktree-lineage 插件的 briefing RPC（只读，可缺席）
下游: app.tsx

## 约定
- 尺寸对齐 bb 原生卡片行：行高 h-6.5、正文 text-xs、图标 size-3.5 灰色、右侧 text-xs tabular-nums 灰色；辅助说明 11px
- 整行按钮加 active:scale-100 与 active:bg-state-active：用户主题对所有按钮做 active scale 0.96（在 @layer components），工具类可覆盖；小图标按钮保留主题反馈
- 一行两个点击区：行体是唯一主操作，次要操作进右侧箭头菜单（桌面下拉、手机底部抽屉）；危险操作一律 MenuConfirmItem / CompactButton 两步确认，第二步不改变控件尺寸
- 可交互与纯信息的区分：能点或带操作的行才有悬停底色，纯信息行没有；光标一律箭头（桌面习惯），只有带下划线的文字链接（如 FileLink）是手形，正文是文字光标
- 动效参数集中在 rows.tsx：折叠 200ms、淡入淡出 160ms、缓动取宿主主题 --glass-ease（回落 Claude Desktop 的 ease-out）
- 图标只用宿主 ICON_NAMES（hugeicons 命名，如 Limitation、TimeSchedule、SideChat），lucide 名会回退成 Zap
- 颜色只用主题变量（--ansi-N、--success、--warning、--destructive）与宿主 token class，不写死色值
- 排版（参照 Synara 的线程信息面板）：内容分组，组名是灰色小标题、组间一条细线；每一项默认只占一行（图标 + 名称 + 一个最要紧的读数 + 箭头），细节一律点开才看，不靠悬停提示；组里的行不重复组名；展开的内容缩进到名称那条线上，读数行名称灰、数值正文色
- 颜色的含义：橙色只表示上下文 / 缓存告警，以及上下文文件上的 M（有未提交改动，借 git 的字母区分，不是告警）；蓝色（--ansi-4）只表示“等你”，与 worktree-lineage 侧边栏里等你的行同色；绿色表示完成，绿点表示已加载（上下文文件、Connectors）
- 渐进展示（参照 Claude Desktop / Ghostex 实测）：每分区一行摘要 → 就地展开（可同时展开多个，超高在卡片内滚动）→ 分类再就地展开前 8 个条目（缩进、带竖线）→ 超出才用 Dialog 搜索全部
- 虚线下划线 = 悬停有解释（不表示可点）；可展开 = 行尾箭头；可点开的文件 = 实线下划线链接
- 改 bb 宿主结构相关的东西只许写在 host-styles.ts，并同步加一条 HOOKS 自检；光标规则只能落在控件本身（cursor 会继承），属性选择器用完整类名 [class~=]，不用子串 [class*=]
- SDK 的 experimental_useRpcQuery 每次渲染返回新的 refetch，不得放进 useEffect 依赖（会无限刷新）；需要时用 ref 取最新值
- 触屏用 pointer-coarse: 变体：行高 36px、行尾箭头按钮 36px
- 卡片里每组注册一个 bb 分区（标题即组名，GROUPS 决定顺序）；项组件无数据时返回 null，一组全空时 bb 不画它的标题

[PROTOCOL]: 变更时更新此文件,然后检查父级 CLAUDE.md
