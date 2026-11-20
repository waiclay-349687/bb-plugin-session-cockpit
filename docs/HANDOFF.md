# 交接说明（2026-11-16，第二轮）

写给接手这个插件的下一个对话。读完本文，再读根目录 `CLAUDE.md` 和 `components/cockpit/CLAUDE.md`，就能接着做。

## 现状

- 仓库：`~/Downloads/GitHub/bb-plugin-session-cockpit`，分支 `main`，提交 `530ffd8`（插件）、`f964689`（交接说明），没有远程仓库，没有推送过。第二轮的改动**未提交**（用户没要求提交）。
- 已安装并在运行：`session-cockpit@0.1.0`，路径安装（bb 直接从本目录加载）。改完代码后 `npm run check`，再 `bb plugin reload session-cockpit`。**reload 只换后端**，已经打开的 bb 窗口要 ⌘R 才加载新前端包。
- 门禁：`npm run check`（类型检查 + 单测 + 构建）全部通过；2026-11-19 Context files 这一轮收尾时是 37 项单测，其中 18 项是 `test/context-files.test.ts`（同一时间另有会话在改 Limits 相关代码，总数以实际运行为准）。
- 依赖的 bb 设置：实验开关 `threadContextCard` 已打开；卡片固定偏好 `threadContextCard.pinned` 为 true。

## Environment 项与微动效（2026-11-19，未提交）

背景：输入框底栏去掉了项目 / 工作区 / Worktree / 分支 / 「在此环境新建线程」，这些信息要落到右上角卡片里（参照 Claude Desktop 右上角 `Environment › Reader-Monorepo` 的层次）。

- **改造前**：卡片里没有任何环境信息（只有 bb 自带的 Parent / Changes 行和 Progress / Usage / Workspace 三组）；`session` 快照里虽有 `environmentId / environmentPath`，界面没用。
- **新增**：`lib/environment.ts`（纯逻辑，7 项单测）+ 服务端 `environment` RPC（环境 / 项目 / 机器三份 DTO 归一，tag `environment:<threadId>`，回合结束时失效）+ `components/cockpit/environment-section.tsx`。桌面用 `experimental_threadContextCardRow` 注册成卡片顶部的无标题行（`2_environment` 组，在 Parent 之后、Changes 之前），不是带组名的分区（行名就是 Environment，再加组名会重复）；横幅里排在所有组之前。分支与改动数跨插件只读 `bb--git` 的 `status`，只在展开时订阅。
- **微动效**：`rows.tsx` 新增 `PRESSABLE` / `CHEVRON_MOTION` / `IconButton` / `CopyButton`，各分区的箭头与可点行统一改用；可点行按下 scale 0.97（用户这次明确要求，取代旧的"整行不缩放"约定）。
- **在界面上验证过**（无头浏览器 1600 宽、900 宽横幅）：worktree（`reader`，Repository `ReadBreakthrough/Reader-Monorepo`，干净）、项目目录（Breakthrough-，16 个改动；后来把状态压短成绿点 / 橙色 `M16`）、长分支 worktree、个人工作区（只有 Personal workspace 与路径）；复制图标交叉淡入对勾、剪贴板内容为完整路径；折叠高度 138→0 平滑、箭头 200ms 旋转；浅色主题；减少动态效果时过渡全部为 none；新建线程落到新建页并预选项目、Reuse 该环境与分支（没有发送）；控制台 0 报错。
- **没验证**：多台机器时的机器名（本机只有一台 host）；环境未就绪时的说明文字；中文界面下的实际排版（词条已加，单测覆盖双语纯度）。

## 第三轮改动（2026-11-18，在 worktree-lineage 的对话里做的，未提交）

用户的三个要求：信息栏里的内容没有层级、把悬停卡片里的"可视化进展"也放进来、信息栏加高。

- **Context files 项（2026-11-19，取代下面的 Instructions 项；方案由用户拍板，词汇在 `GLOSSARY.md`）**：`components/cockpit/context-files-section.tsx` + `lib/context-files.ts`（纯逻辑，18 项单测）+ 宿主端 `listContextFiles`（`host.ts`，只用 `git ls-files` / `git status --porcelain` / stat / readdir / readFile，每个工作区缓存 15 秒，出错返回空）+ 服务端 `contextFiles` RPC（缓存 15 秒，回合结束时清缓存并失效）。旧的 `instructions` RPC、`instructions-section.tsx` 和对 `bb.sdk.files.read` 的探测都删了；分区 id 改为 `contextFiles`，旧偏好里的 `instructions` 会被 `readPrefs` 过滤掉（隐藏过 Instructions 的人会重新看到这一项）。七个层级、已加载 / 不知道 / 有改动三态、导入、模块弹层的口径见 README。
  - **在界面上看过**（隔离浏览器，`<线程 id>`，1440 宽）：收起一行 `3 loaded · 80`；点开四个层级（Global 3 / Project 2 / Modules 68 / Memory 7）；Global 下 `~/.claude/CLAUDE.md` 带 7.4k 与绿点、下面缩进着导入的 RTK.md；Modules 就地只有 `All 68 · search`；弹层按 apps 28 / packages 16 / docs 9 / data 3 / other 12 分组、过滤、无匹配；Codex 线程与本线程（没有明细）只写总数并有一句 `Loaded: unknown`；手机 390 宽的横幅详情与底部抽屉（行高 36px）；点 Project 的 CLAUDE.md 在右侧面板打开预览，菜单三项都在；旧偏好里带 `instructions` 时不崩。`handlerStats` 20 秒只增加 6 次调用。
  - **只用假数据看过**：`M` 标记、Parent / Local / Rules 三个层级、模块的 `· AGENTS.md` 后缀与路径中间省略——四条可打开的线程里没有带未提交改动的 git 工作区，也没有这三个层级的文件，所以在页面里改写了 `contextFiles` 的响应（只影响测试页）。接口层面 `changed` 在别的线程上验证过（`<线程 id>`：519 个模块、324 条自动记忆、`website/CLAUDE.md` 有改动）；非 git 工作区的有界遍历也只在接口层面验证过（`<线程 id>` 等三个工作区各找到 1–4 个模块文件）。
  - **没验证**：Open in editor（会在用户桌面上弹出编辑器）、Copy path 的实际剪贴板内容、在弹层里点一项（会给用户的线程多留一个面板标签；就地的文件行点过，走的是同一个预览调用）、远程宿主机、Windows 路径（`lib/context-files.ts` 只处理 posix 路径）。
  - **已知的缺口**：被 .gitignore 忽略的子目录 `CLAUDE.local.md` 找不到（发现只用 `git ls-files -co --exclude-standard`；根目录那份是直接 stat 的，找得到）；工作区是仓库子目录时，同一仓库里上级目录的文件不标有改动；个人工作区的线程也会显示这一项（Global 和它自己的自动记忆是真实存在的文件）。
- **Context files 收尾（2026-11-19，worktree-lineage 的对话里）**：文件行的菜单箭头改成悬停才出现（`CardRow` 的 `quietMenu`），不再每行一个箭头；修了 `host-styles.ts` 里 `height` 自检的误报（算出来的 max-height 是 `min(864px, …)` 表达式，原先用 parseFloat 判断恒为 NaN，会弹“失效”提醒）。同一时间另有会话在把计划额度移到 usage-rings 插件，工作区里混着两边的改动；按用户的要求，连同那边的改动一起提交在分支 `feat/session-panel-groups-and-context-files` 上。
- **Instructions 项（同日，用户确认要加；Notepad 确认先不加；2026-11-19 已被上面的 Context files 取代）**：`instructions-section.tsx` + 服务端 `instructions` RPC。在界面上确认了：文件列表、点行体在右侧文件面板打开 CLAUDE.md、菜单三项都在。**没点过** Open in editor（会在用户桌面上弹出编辑器）。
- **第三版（同日，用户说第二版仍然乱、没有疏密主次和点开看详情，并给了 Synara 面板的截图）**：内容分成 Progress / Usage / Workspace 三组（`cockpit.tsx` 的 `GROUPS`），每组注册成 bb 卡片的一个分区，组名和分隔线由 bb 画；每一项默认只占一行、全部收起；Progress 收起时只有“当前阶段 + n/m”，点开才是概括和完整轨道；Now / Next / Needs you 全部拿掉（用户明确不要）；Usage 那一项改名 Limits；偏好升到 v6 并清掉旧的展开状态。已在界面上看过默认状态、Progress 点开、Limits 点开、深色、1280×800 横幅、v5 → v6 迁移。
- **第二版（同日，用户说第一版太凌乱）**：去掉分区引导线，展开内容统一缩进到名称线（全卡两条左对齐线、每分区最多一条竖线）；阶段轨道改成步骤条（过去的阶段只占一行，结论进悬停提示）；Now / Needs you / Next 三行改成末尾三选一（蓝色 Needs you 提示块 / Now + Next 两句 / 落后时一句说明），不再复述最新要求和答复；Token 明细收成一行 `Tokens`；“等你”改用蓝色（与侧边栏一致），橙色只留给额度。
- **层级**：新增 `rows.tsx` 的 `SectionBody`（分区展开内容统一缩进），所有分区改用它；`CardRow` 加 `stat`（读数行：名称灰、数值正文色、不带图标），Usage 展开的行全部改成读数行。
- **Progress 分区**（`progress-section.tsx`，排第一、默认展开）：跨插件只读 `worktree-lineage` 的 `briefing` RPC。速览怎么写、何时写、花多少，都在那个插件里（见它的 README）；这里从不触发生成。
- **加高**：`host-styles.ts` 把卡片上限从 36rem 提到 54rem，并加了第七项自检 `height`。
- **切换会话**：bb 切换会话会重建线程视图，原先卡片会重播滑入（看起来消失又出现）。现在导航发生且卡片开着时打一个 0.7 秒的标记，新卡片直接出现在原位。依赖浏览器的 Navigation API（`navigation` 的 `navigate` 事件），没有时退回原来的滑入。
- **偏好**：升到 v5，读不到时从 v4 迁移并把 Progress 默认展开一次。
- **已在界面上验证**（隔离浏览器，浅色 + 深色）：有速览且没落后（`Now / Needs you`）、速览落后（`Since then / Reply` + 说明）两种状态；Context（含展开一个分类）、Usage、Servers、Scripts 在新缩进下的样子；加高；v4 → v5 迁移（写入旧偏好后重载：Progress 展开、旧的展开 / 隐藏 / 样式开关都保留）；切换会话时卡片逐帧采样（透明度始终为 1，高度 611 → 525 平滑过渡）。**没验证**：还没有速览的对话、手机横幅里的样子、Connectors 与 Side chats 分区。
- `npm run check` 通过（类型检查 + 20 项单测 + 构建）。

## 插件做什么

- **桌面**：线程右上角的线程上下文卡片里有一块「Session」，六个分区各一行摘要，点开就地展开（可同时展开多个）：Context、Usage、Servers、Scripts、Connectors、Side chats。行是「行体主操作 + 右侧箭头菜单」两个点击区。
- **手机与窄窗口**：bb 不显示卡片，入口是输入框上方横幅里的摘要，点开在横幅下方展开同一套内容；菜单变底部抽屉。
- **界面修饰**（`components/cockpit/host-styles.ts`，内容脚本注入，与主题无关）：卡片滑入淡出、对话区平滑让位、历史提问导航条保持在卡片左侧、按钮与列表行用箭头光标（链接手形、正文文字光标）。带六项结构自检，bb 升级导致失效时弹提醒并给出修复指令。
- **给 agent 的命令**：`bb session-cockpit summary`、`bb session-cockpit servers`。

完整功能与口径见 `README.md`（第二轮已按当前功能重写）。

## 用户的偏好（已多次确认，别再问）

- 一律中文沟通；交付要直接给结论和已拍板的方案。
- 卡片要在对话区右上角，不要做成右侧边栏的标签页。
- 按钮和列表行用箭头光标（macOS 原生习惯），只有链接是手形；**消息正文必须保留文字光标**（要能选字 Add to chat）。
- 动效要丝滑：200ms 级、ease-out；反感瞬间跳变（包括菜单宽度跳动）和夸张的按下缩放。
- 界面改动要对所有主题生效，不能写进某一个主题。
- bb 升级导致界面修饰失效时，必须能被提醒并拿到解决办法。
- Context 明细与 bb 自带圆环重复，用户已说不用管。
- 分区不要「同时只能展开一个」的限制。

## 第二轮界面验证结果（无头浏览器实测，2026-11-16）

| # | 项目 | 结果 | 证据 / 备注 |
|---|---|---|---|
| 1 | side chat 菜单 Rename | 通过 | 菜单选 Rename 后输入框持续持有焦点（50–1200ms 采样）；回车提交标题即时刷新；Esc 取消。测试用的 side chat `<线程 id>` 已重新归档，标题留为 "Cockpit rename test"（接口不能把标题清回空） |
| 2 | Servers「Other thread」与折叠行 | 通过 | 本线程起的服务在前，「6 from agents & other threads」折叠行可展开；其他线程看到的同一服务标「Other thread · Agent · Python」 |
| 3 | docker compose 端口 | 通过 | 一个带 docker compose 的工作区的 4 个 compose 容器显示为「Docker · 服务名」，另一个 worktree 的容器被排除；非 HTTP 端口菜单里没有 Open。用带 compose 标签的一次性 redis 容器验证了菜单两步停止，容器已停止并删除 |
| 4 | `.bb/ports.json` 命名 | 通过 | 行上显示为「Cockpit test :8765」，CLI 显示「Cockpit test: Python」 |
| 5 | 停止服务的两步确认 | 通过 | 菜单不关、文案变红色「Confirm stop」，再选一次发 SIGTERM，toast 提示，列表刷新 |
| 6 | Context 的 Compact | 只验证了第一步 | 点一下变红色「Confirm」、宽度不变、3 秒复位；运行中的线程里按钮禁用。**第二下没点**：会不可逆地压缩用户的真实线程，需用户同意或用一次性线程 |
| 7 | 带预览地址的脚本自动打开预览 | 通过 | 终端里先开 shell 再键入命令，输出保留；约 2 秒后预览地址打开 |
| 8 | 上下文 80% 提示 | 通过 | 87.7% 的线程 `<线程 id>` 显示橙色「12% left…」 |
| 9 | 记忆文件链接预览 | 通过 | 点开在右侧面板预览文件；主窗格变窄后自动切到横幅模式 |
| 10 | 设置页两个开关与 Copy fix prompt | 通过 | 开关即时改注入的样式；模拟失效后设置页和 toast 都出现修复入口；设置页按钮与 toast 按钮（改走 SDK 复制后）都点过，复制内容完整并提示 Copied |
| 11 | 手机视口 | 通过 | 390 宽 + 触屏模拟：横幅摘要可展开、限高半屏内部滚动，行高 36px，箭头按钮 36×36，菜单变底部抽屉，两步删除在抽屉里正常 |

## 第二轮修掉的问题

- **点击卡顿的头号嫌疑（已修，待真机确认）**：`data.ts` 的 `useServers` 把 SDK 返回的 `refetch` 放进了 effect 依赖，而 `experimental_useRpcQuery` 每次渲染都返回新的 `refetch`（见 `node_modules/@get-bb/plugin-sdk/dist/internal/rpc-query-host.js` 约 2425 行）。只要 Servers 分区展开，就「刷新 → 重渲染 → effect 重跑 → 再刷新」无限循环：实测后端 `servers` 接口每秒约 420 次，插件累计处理 205 万次调用、5000 多秒。改为用 ref 取最新 `refetch` 后：挂载 1 次请求、收起 0 次、展开恰好 1 次、之后 30 秒一次；空闲 10 秒 0 个长任务。证据的边界：采样时无头页面多数时间处于横幅模式，测到的负载主要来自另一个客户端；修复后无头的点击耗时（29–75ms）与第一轮记录的约 50ms 同量级，没有修复前后的同条件对比；用户窗口尚未刷新，真机未验证。判伪条件：用户 ⌘R 后 `session-cockpit` 的 handlerStats count 每 20 秒只增个位数；若仍在涨，说明还有别的来源。
- **消息正文选字没有文字光标**（用户反馈，已在无头浏览器确认修复：整页 387 段文字含文件预览面板 254 段，0 段是箭头）：光标规则用子串匹配 `[class*="cursor-pointer"]`，误中 bb 对话容器上的 `[&_button:not(:disabled)]:cursor-pointer`（给容器里按钮加手形的写法），容器被设成箭头后正文全部继承。改为完整类名 `[class~="cursor-pointer"]`，并单独把这类容器里的按钮还原成箭头；新增反向自检 `text`（正文段落不许是箭头）。修复后 138 段正文全部是文字光标。
- 记忆文件链接被插件自己的光标规则改成了箭头，与「链接是手形」矛盾：带 `underline` 类的文字链接恢复手形。
- Server 行的长归属说明（「Other thread · claude session」）把地址挤成「loca…」：`CardRow` 新增 `priority="label"`，Server 行地址完整、归属截断，完整信息在悬停提示。
- 两步确认文案（「Stop pid 28377? Click again」）让菜单从 166px 跳到 198px，触屏上还写着 Click：统一为「Confirm stop / Confirm remove」，菜单宽度不变。
- Usage 里「缓存快过期」提示的 Compact 是单击即执行，违反两步确认约定：改为复用 Context 的 `CompactButton`。
- CLI `servers` 对 docker 行显示「pid 0」：改为显示容器名，并带上 ports.json 名字和 `[other thread <id>]`。
- 设置页里关掉的自检项显示「Not checked」：新增状态 Off，开关后立即复查。toast 里的复制改走 SDK 的 `experimental_copyToClipboard`。
- side chat 改名为空或没改时不再发请求。
- 文档：README、`PLUGIN_OVERVIEW.md`、`skills/session-cockpit/SKILL.md`、根 `CLAUDE.md`（prefs v4）、`components/cockpit/CLAUDE.md`、`lib/CLAUDE.md`、`contract.ts` 注释已同步到当前功能。

## 第二轮只过了类型检查、没在界面上点过的

- Usage「缓存快过期」提示里改成两步确认的 Compact（需要缓存剩余 <10 分钟且上下文 ≥100k 才出现）。
- side chat 改名的「空名或没改不发请求」保护。
- `text` 自检最后加的排除条件（可点控件里的段落不算）。

（「Confirm remove」文案、改动后 CardRow 的桌面与手机布局、toast 的复制、轮询节奏已在收尾时补验通过。）

## 已知问题与欠账

- **用户的 bb 窗口要刷新一次**：第二轮结束时后端仍有每秒约 500 次 `servers` 调用，来自还在跑旧前端包的客户端（判断是用户的 bb 桌面窗口）。⌘R 后用下面的命令复查，`session-cockpit` 的 count 每 20 秒应只增加个位数：

  ```sh
  bb plugin list --json | python3 -c "import json,sys; [print(p['id'], p['handlerStats']) for p in json.load(sys.stdin) if p['id']=='session-cockpit']"
  ```

- **剩余的点击开销**：展开 Context 分区时有一个约 65ms 的长任务（无头浏览器、无显卡，渲染一批分类行）。界面修饰开关的 A/B 对比无差异（中位数 70ms 对 71ms），排除了 `:has()` 选择器。真机上应明显更低；若用户仍觉得卡，在 bb 里打开 DevTools 的 Performance 录一次展开 Context。
- **bb 终端起的服务读不到线程**（终端进程没有 `BB_THREAD_ID`），会被同一工作区的每个线程当成自己的。docker 容器同理。
- **其他线程的可停止服务**在本线程的菜单里也能停（同工作区、同样经过宿主端重新判定）。没有改，等用户决定要不要限制成「只能停本线程的」。
- **自检有盲区**：只在线程页开着时才跑；bb 若一次改掉多处结构，部分检查会因找不到前提而跳过。
- **agent 名单是写死的**：`lib/lsof.ts` 的 `AGENT_CLIS`，出现新的 agent 工具要手动加。
- **回合计时只统计最近约 250 个回合**（事件接口单页上限 100，最多翻 5 页）。
- **脚手架带来的 `components/ui/card.tsx` 没有用到。**
- 线程的持久化面板标签里还留着 `plugin-fixed:session-cockpit:session`（第一轮做成侧栏标签页时留下的，当前插件不再注册该标签），`bb thread tabs show <id>` 可见，未清理。
- 没有前端单测：`useServers` 这类 hook 级回归只能靠界面验证和 `handlerStats` 调用率发现；约定已写进 `components/cockpit/CLAUDE.md`。

## 做过的取舍（别推翻，除非用户要求）

- 计划额度已移出本插件，改由 usage-rings 插件在侧边栏 rail 显示（账号级信息不放在线程卡片里，避免两处重复）。
- 不做按模型价格估算成本：需要持续维护价格表，没有可靠的现价来源。provider 报了成本才显示。
- 不做 CPU、内存、发热历史：那是 Hotspot 插件的事。
- 不猜 side chat 来自哪条消息：等 bb 原生记录。
- 停止进程只允许 agent 启动的、bb 终端启动的、工作区 compose 的容器；agent 进程本身和来路不明的常驻进程不允许停。宿主端停止前会重新扫描、重新判定。
- 借鉴来源（均为 MIT）：Worktree Ports（docker 端口、ports.json、/proc）、Hotspot（BB_THREAD_ID 线程归属）、Side Chat Links（改名）。

## 踩过的坑

- **SDK 的 `refetch` 每次渲染都是新函数**，放进 effect 依赖会无限刷新（第二轮的卡顿根因）。
- **光标规则不能用子串匹配类名**：bb 的 Tailwind 任意变体（如 `[&_button:not(:disabled)]:cursor-pointer`）会被 `[class*=]` 误中；`cursor` 会继承，落到容器上就毁掉整片正文的文字光标。
- **宿主图标名**是 hugeicons 命名（`Limitation`、`RotateCcw`、`Plug02`、`TimeSchedule`、`SideChat`、`Columns2`），写 lucide 名会回退成闪电图标。完整清单在运行中的页面里：`globalThis.__bbPluginRuntime.sharedUiIcon.ICON_NAMES`。
- **事件接口单次最多 100 条**，超过会报 400。
- **token 口径各家不同**：Claude 的 `inputTokens` 不含缓存，Codex 的含缓存；`lib/usage.ts` 按 `totalTokens` 满足哪条等式自动判断。Claude 的 `last` 是上一整个回合的合计，不是单次请求。
- **终端用 `command` 模式启动时进程一结束就关闭**，短命令的输出会丢；所以运行脚本是先开 shell 再键入命令。
- **无头测试时点「Pin/Unpin thread context」会改用户的服务端偏好**，测完用 `bb settings ui set threadContextCard.pinned true` 恢复。
- **右侧面板（预览、终端）打开时主窗格变窄**，卡片消失、切到横幅；无头测试要先点「Hide right panel」。
- **取消归档 side chat 要先取消归档它的来源线程**（lifecycle owner），否则 409。
- **卡片最高 576px**（bb 定的），超出在卡片内滚动。
- **后台点击对 Claude Desktop 无效**，用 `orca computer` 操作它需要 `--restore-window`（会占用屏幕）。
- **沙箱里的 Bash 写不了这个仓库和 `~/.bb/theme`**，需要关闭沙箱或用 Edit/Write 工具；docker 也只能在沙箱外调用。
- **用户的 bb Glass 主题**对所有按钮有按下缩放（`scale: 0.96`）；插件的行与按钮统一用 `rows.tsx` 的 `PRESSABLE`（`active:scale-[0.97]`，同为 `scale` 属性，覆盖而不叠乘；2026-11-19 起取代原来的 `active:scale-100`）。用户当前用的是 Dracula 主题。

## 验证方法

```sh
npm run check                                   # 类型检查 + 单测 + 构建
bb plugin reload session-cockpit                # 然后已打开的 bb 窗口 ⌘R
bb session-cockpit summary --thread <id>        # 后端数据
bb session-cockpit servers --thread <id> --json
bb browser-automation open --backend local --headless --machine <host-id> --json
# 然后打开 http://127.0.0.1:38886/projects/<项目>/threads/<线程>，宽度 ≥1520 看卡片，390 + 触屏模拟看手机
```

无头脚本里 Radix 菜单用 puppeteer 的 `ElementHandle.click()`（真实指针事件）打开，触屏模拟下用 `tap()`。测试夹具的做法：从 agent 的 Bash 起服务得到 agent-child（带本线程 `BB_THREAD_ID`），用 Scripts 在终端里起服务得到 terminal，用 `docker run --label com.docker.compose.project.working_dir=<工作区>` 模拟 compose 容器。

参考截图（Claude Desktop、Ghostex、T3 Code 点开后的样子）在线程 `<线程 id>` 的存储目录 `ref/` 下，线程删除后会消失。

## 建议的下一步

1. 用户的 bb 窗口 ⌘R 后，用上面的 `handlerStats` 命令确认调用率降下来，再问用户点击是否还卡。
2. 经用户同意后验证 Compact 第二步（用一次性线程或用户指定的线程）。
3. 用户决定：其他线程起的服务要不要禁止从本线程停止。
4. 视需要给 Context 展开做渲染优化（分类行较多时的约 65ms 长任务）。
