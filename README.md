# Session Cockpit（会话驾驶舱）

往每个线程对话区**右上角**的线程上下文卡片里加几块分区：上下文窗口里装了什么、Prompt 缓存还热不热、agent 在工作区里起了哪些服务、本线程的 side chat 和常用脚本。

## 设计逻辑

Claude Desktop 和 T3 Code 的共同点：状态信息是对话视图自己的一部分。它们的做法是：

- 固定在对话区右上角，贴着对话流，滚动时不动，一眼可读，而不是要切过去的侧栏标签页。
- 只有一列，从上到下堆分区，没有标签页。
- 每个分区紧凑，细节就地展开（Claude 带虚线下划线的分类点开看明细，T3 每一项都是一行）。
- 窗口窄时退化为从顶部按钮弹出。

bb 的**线程上下文卡片**正是这个位置：

- 宽窗口时卡片与对话流并排，中等宽度时把对话流挤开，可在标题栏按钮固定或取消固定。
- 窄窗口时退回输入框上方的横幅，卡片从标题栏「Thread context」按钮弹出。
- bb 自己的父线程、Changes、PR、Child threads 已经在卡片里，相当于 T3 的 git 区和 Lineage。

本插件只往这张卡片里补一个「Session」分区，不另开面板。

### 分组与一行一项

卡片里的内容分三组，组名是灰色小标题，组间一条细线（参照 Synara 的线程信息面板）：

- **Progress**：这条对话到哪了。
- **Usage**：Context（上下文窗口）、Session（本会话的缓存、时长、成本与 token；账号级计划额度在 usage-rings 插件的侧边栏圆环里）。
- **Workspace**：Servers、Scripts、Context files（上下文文件）、Connectors、Side chats。

每一项默认只占一行：图标、名称、一个最要紧的读数、箭头。细节一律点开才看，默认全部收起，展开状态记在本机。

### Progress：这条对话到哪了

收起时一行：当前阶段的名称和完成数，如 `● 右上角 Session 信息栏  3/4`。点开是一句话概括和完整的阶段轨道（完成 / 进行中 / 已放弃，各带一句结论）。

内容来自另一个插件 `worktree-lineage` 写好并存盘的"全程速览"（每轮对话结束后由本机的小模型读整条对话的提要写出），本插件只读、从不触发生成，所以多显示这一处不多花额度。速览落后于对话时（比如这一轮还在跑），点开后末尾有一句“这一轮结束后更新”。没装那个插件时这一组不出现。

### Context files：哪些文件在给 agent 定规矩

上下文文件是写给 agent 看、固定它在某个范围内行为的说明文件（CLAUDE.md、AGENTS.md 这一类）。这一项把磁盘上的全部上下文文件按层级列出来，一个文件只属于一个层级：

| 层级 | 是什么 |
|---|---|
| Global | 用户目录下对所有项目生效的：`~/.claude/CLAUDE.md`、`~/.codex/AGENTS.md`、`~/.gemini/GEMINI.md` |
| Parent | 工作区之上各层目录里的 CLAUDE.md / CLAUDE.local.md / AGENTS.md / AGENTS.override.md / GEMINI.md（最多向上 12 层，到用户目录为止） |
| Project | 工作区根目录里的同名文件，加上 `.claude/CLAUDE.md` |
| Modules | 工作区子目录里的 CLAUDE.md / AGENTS.md / GEMINI.md，一个目录一份。遵守 .gitignore（git 仓库里用 `git ls-files`，不进 node_modules）；不是仓库时做有界的目录遍历 |
| Local | CLAUDE.local.md：只在本机生效、不随仓库共享 |
| Rules | `.claude/rules/` 与 `~/.claude/rules/` 下直接放着的 `*.md` |
| Memory | agent 自己写下的自动记忆：`~/.claude/projects/<工作区路径换成横线>/memory/` 与 `.claude/memory/` 下的 `*.md` |

没有文件的层级不显示；一个上下文文件都没有时，这一项不出现。

每个文件有三种可能的标记：

- **已加载**（绿点和 token 数）：这份文件的内容在本对话里进过模型的上下文。唯一的依据是 provider 上下文明细里的 Memory files 条目。实测这份明细只列全局的 CLAUDE.md、项目层级的 CLAUDE.md 和自动记忆的 MEMORY.md，模块文件从不出现在里面，所以模块层级不会有已加载标记。
- **不知道**：线程没有上下文明细时（Codex 线程，或明细还没采到），所有文件的已加载状态都是不知道——不画标记，摘要只写总数，点开后末尾有一句 `Loaded: unknown`。不会把“不知道”写成“0 个已加载”。
- **有改动**（橙色 `M`）：文件在工作区里有未提交的改动（含未跟踪）。仓库之外的文件（Global、`~/.claude` 下的自动记忆）没有这个标记。

被别的上下文文件用 `@路径` 引进来的文件（导入）紧贴在引它的文件下面、缩进一格、前面带 `↳`，不单独算一个层级，也不计入个数。只在 Global / Parent / Project / Local / Rules 的文件里找导入，且只有解析到真实存在的文件才算（`@get-bb/plugin-sdk` 这类包名不算）。

展示分三层：收起时一行（如 `3 loaded · 80`）→ 点开是每个层级一行（个数、已加载数、有没有改动）→ 再点开一个层级看它的文件。点文件在 bb 右侧的文件面板里预览；行尾菜单里可以用外部编辑器单独打开，或复制路径。

模块往往有几十上百个，不会全摊开：一个层级超过 8 个文件时，就地只列已加载的和有改动的（自动记忆的 MEMORY.md 总在最前），其余点 `All N · search` 进弹层看。弹层里模块按顶层目录分组（`apps 28`、`packages 16`……按个数从多到少，只有一两个文件的目录并进 `other`），可按路径过滤，点一项即预览并关闭弹层。

### 三层渐进与手机

卡片高度有上限（bb 默认 576px，本插件的界面修饰把它提到 864px），所以内容分三层展示，桌面和手机共用同一套。层级用缩进表示：分区行是图标加粗体名称，展开的内容整体缩进到名称那条线上，图标只在最左一列；读数行名称灰、数值黑；Token 明细默认收成一行。

1. **摘要**：每个分区一行（如 `Context 7% · 73k/1M`、`Usage Weekly 87% · cache cold`）。
2. **就地展开**：点一行展开该分区，各分区独立展开，可同时展开多个；超出卡片高度时在卡片内滚动。默认全部收起，之后记住上次的选择（存在本机）。
3. **弹层**：技能、MCP 工具这类长列表就地只列前 8 项，更多时点「All N · search」进弹层（桌面居中，手机是底部抽屉），可过滤。

手机上 bb 不显示线程上下文卡片，入口是输入框上方横幅里的摘要（如 `Cache 42m · Weekly 2%`）：点它在横幅下方展开同一套内容（限高半屏、内部滚动）。触屏下行高 36px，行尾箭头按钮 36px，菜单变成底部抽屉。窄的桌面窗格（比如右侧开着预览或终端时）同样走横幅。

下表的「分区」对应第二层展开后的内容。

| 分区 | 借鉴来源 | 内容 |
|---|---|---|
| Context | Claude Desktop · Context | 摘要是占用百分比和 token 数，点开后是分段占用条、分类 token 与占比、Autocompact buffer / Free space、按需加载的工具单列。带数字和箭头的分类可就地展开到每个记忆文件、技能、MCP 工具，记忆文件点开在 bb 预览里查看。占用到 80% 时出现提示。底部是测量时间和两步确认的 Compact |
| Usage | Ghostex · Limits | Prompt 缓存（使用中 / 热及倒计时 / 冷，变冷后提示下一条消息要重读多少 token，快过期且上下文较大时提示先压缩）、agent 工作时长与回合数、成本（provider 报了才显示）、Token 明细（命中率与读写量） |
| Servers | T3 Code · Servers | 只列工作区内的监听。本线程自己的服务在前（agent 或 bb 终端起的、工作区 docker compose 容器）；agent 会话自己的端口和其他线程起的服务折叠在「N from agents & other threads」里，其他线程的标「Other thread」。行体点击打开网页（非 HTTP 端口不可点），箭头菜单里有打开、复制地址、停止（两步确认） |
| Scripts | T3 Code · Project scripts | 每个项目一组常用命令。行体点击即在线程终端里运行（先开 shell 再键入，跑完输出保留）；可填预览地址，运行约 2 秒后自动打开。箭头菜单里有运行、打开预览、复制命令、编辑、删除（两步确认） |
| Connectors | Claude Desktop · Connectors | 从上下文里的 MCP 工具条目反推本会话加载了哪些 server，绿点表示工具已加载，灰点表示按需加载；全部列出 |
| Side chats | T3 Code · Side chats | bb 内置 side-chat 插件创建的隐藏 fork，行体点击在分屏打开，箭头菜单可改名；没有时整块不显示 |

「Choose details」（显示哪些分区）放在插件设置页，不占卡片高度。

### 界面修饰（Interface polish）

除了卡片里的分区，插件还用内容脚本对 bb 自己的界面做了几处修改，在所有主题下生效，设置页可分别关闭：

- **卡片动效**：卡片滑入淡出，对话区平滑让位，历史提问导航条移到卡片左侧、不被卡片挤掉；卡片最高从 576px 提到 864px；在会话之间切换时卡片留在原位只换内容（不重播滑入，先保持上一张的高度，再平滑收到新内容的高度）。
- **桌面光标**：按钮、标签页、列表行用箭头光标（macOS 原生习惯），只有正文链接、外链和带下划线的文字链接是手形；消息正文保留文字光标，可以直接选字。

这些规则依赖 bb 未承诺稳定的页面结构，所以自带七项自检（结构是否还在、光标是否生效、正文是否仍是文字光标）。bb 升级导致失效时会弹提醒，设置页显示哪一项失效，并提供「Copy fix prompt」：把复制的指令发给任意 bb 线程，agent 就能照着修。

## 交互约定

- **尺寸**：照抄 bb 原生卡片行，行高 26px、正文 12px、图标 14px、右侧灰色等宽数字。分类明细行 24px，与 Claude Desktop 一样更紧凑。
- **按下反馈**：整行按钮不做缩放，改为背景加深。你的 bb Glass 主题给所有按钮加了 `active` 时 `scale: 0.96`，288px 宽的行会缩进约 11px，观感过猛。主题把这条规则放在 `@layer components`，所以这里用工具类 `active:scale-100` 就能覆盖，不改主题。bb 原生行（如 Changes）仍会缩放，这是主题本身的行为。
- **一行两个点击区**（T3 Code 的做法）：行体执行主操作（Server 打开、Script 运行、Side chat 分屏打开），右侧独立的箭头按钮展开菜单放次要操作。两个区各有自己的悬停底色。没有操作的纯信息行没有悬停底色。
- **放不下时谁让位**：一般行右侧数值完整、名称截断；Server 行反过来，地址完整、归属说明截断，完整信息在悬停提示里。
- **危险操作两步确认**：菜单里的停止服务、删除脚本，第一次选中菜单不关、文案变成红色「Confirm stop / Confirm remove」，再选一次才执行，菜单宽度不变；Compact 按钮第一次点击变红色「Confirm」，3 秒内再点才执行，按钮宽度不变。
- **动效**：展开收起 200ms、淡入淡出 160ms、ease-out，系统开启「减少动态效果」时关闭。

## 数据来源与口径

- **上下文**：`bb.sdk.threads.context()`。Claude Code 提供分类明细，其他 provider 只有总量（此时没有展开箭头）。
- **Token 与缓存**：线程事件 `thread/tokenUsage/updated`。各家 `inputTokens` 口径不同（Claude 不含缓存，Codex 含缓存），按 `totalTokens` 满足哪条恒等式自动归一。Claude 的 `last` 是上一回合的合计，标为 "Last turn"。
- **缓存冷热**：推算值，即最后一次用量上报时间 + provider 声明的 TTL。回合进行中视为使用中。Codex 不报 TTL，显示 Not reported。
- **工作时长**：回合开始 / 结束事件，最多统计最近约 250 个回合。
- **计划额度**：已移到 usage-rings 插件（侧边栏 rail 圆环），本插件不再读取，避免两处各算一份。
- **Servers**：宿主入口在线程所在机器执行 `lsof -iTCP -sTCP:LISTEN`，只保留进程工作目录在工作区内的监听，按进程树判定归属：
  - **agent**：进程本身是 agent CLI（会话自己的 IDE / MCP 端口），不可停止
  - **agent-child**：由 agent 启动，可停止
  - **terminal**：在 bb 终端里启动，可停止
  - **docker**：工作区里 docker compose 项目发布的端口（按 compose 的工作目录标签归属），可停止（`docker stop`）
  - **other**：其他常驻进程，来路不明，不可停止

  **线程归属**：bb 给它启动的 agent 导出 `BB_THREAD_ID`，子进程继承，所以 agent 起的服务能认出是哪个线程起的；共用一个工作区的多个线程由此区分。bb 终端和 docker 容器读不到线程，算作工作区里每个线程自己的。思路来自 Hotspot 插件（MIT）。

  **端口命名**：工作区的 `.bb/ports.json`（`{"ports":[{"port":5173,"label":"Web","scheme":"http"}]}`）可以给端口起名，行上显示为 `Web :5173`。docker 识别和端口命名的思路来自 Worktree Ports 插件（MIT）。

  停止前宿主端会重新扫描、重新判定，防止 pid 复用误杀。收起时只在挂载时扫一次，展开后每 30 秒重扫（页面不可见时不扫）；宿主端同一工作区 5 秒内去重，HTTP 探测按 pid:端口缓存 60 秒，agent 端口不探测。
- **Side chats**：`threads.list({ sourceThreadId, originPluginId: "side-chat", includeHidden })`，改名用 `threads.update`。

## 前置条件

线程上下文卡片目前是 bb 的实验功能，需要打开，并让卡片保持固定：

```sh
bb settings experiment threadContextCard true    # 关闭: ... false
bb settings ui set threadContextCard.pinned true
```

关闭实验后卡片分区不显示，只剩横幅里的摘要。

## Agent 命令

```sh
bb session-cockpit summary [--thread <id>] [--json]
bb session-cockpit servers [--thread <id>] [--json]
```

线程内省略 `--thread` 即指当前线程。用法说明见 `skills/session-cockpit/SKILL.md`（bb 会自动注入给 agent）。

## 开发

```sh
npm install
npm run check          # tsc + 单测 + bb plugin build
bb plugin install .    # 首次安装（路径安装，直接从本目录运行）
bb plugin reload session-cockpit
```

`bb plugin reload` 只换后端；已经打开的 bb 窗口要刷新（⌘R）才会加载新的前端包。

单测用 Node 自带测试器跑 `test/*.test.ts`，样本取自真实线程并已脱敏（`test/fixtures/` 只保留用量类事件）。界面验证步骤见 `docs/HANDOFF.md`。
