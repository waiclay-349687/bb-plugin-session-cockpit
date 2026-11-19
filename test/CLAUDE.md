# test/
> L2 | 父级: ../CLAUDE.md

## 成员清单
- i18n.test.ts 验证双语纯度、自动语言优先级、映射与本地化格式。
- usage.test.ts 验证用量口径、缓存与官方分类。fixtures/ 提供脱敏的用量样本。
- context-files.test.ts 验证文件发现、层级和已加载状态。
- context-estimate.test.ts 用合成事件验证读取追踪、压缩重置、文件去重及预算对齐。
- context-host.test.ts 用临时文件和符号链接验证宿主七层扫描。
- lsof.test.ts 验证监听端口解析与进程归属。

## 边界
测试消费 lib/ 的公开函数。真实线程的界面验证通过本机 bb 和无头浏览器执行。

[PROTOCOL]: 变更时更新此文件,然后检查父级 CLAUDE.md
