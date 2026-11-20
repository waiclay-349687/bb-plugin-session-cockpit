# test/
> L2 | 父级: ../CLAUDE.md

## 成员清单
- i18n.test.ts 验证双语纯度、自动语言优先级、映射与本地化格式。
- cockpit-prefs.test.ts 验证板块排序、旧数据迁移、语言覆盖和显示参数边界。
- briefing-config.test.ts 验证跨插件配置契约容错、输入边界和差量提交。
- progress-view.test.ts 验证异语种与中英混写的速览原样显示（不退化成占位字）、空字段才用占位字，以及 Progress 改语言时同步速览生成语言的补丁。
- briefing-regenerate.test.ts 验证重新生成结果的容错解析、按钮出现条件、结果到提示词条的映射与两种语言的文案纯度。
- usage.test.ts 验证用量口径、缓存与官方分类。fixtures/ 提供脱敏的用量样本。
- context-files.test.ts 验证文件发现、层级和已加载状态。
- context-estimate.test.ts 用合成事件验证读取追踪、压缩重置、文件去重及预算对齐。
- context-host.test.ts 用临时文件和符号链接验证宿主七层扫描。
- environment.test.ts 用脱敏的环境样本验证环境类型、remote 归一、个人工作区与非 git 降级、git 状态（含新增 / 删除行数）、路径切分与 ~ 缩写，以及分支浮层的 worktree 解析、默认分支推断、排序与标记、搜索过滤。
- lsof.test.ts 验证监听端口解析与进程归属。

## 边界
测试消费 lib/ 的公开函数。真实线程的界面验证通过本机 bb 和无头浏览器执行。

[PROTOCOL]: 变更时更新此文件,然后检查父级 CLAUDE.md
