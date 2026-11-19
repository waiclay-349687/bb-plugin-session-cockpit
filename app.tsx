/**
 * [INPUT]: 依赖 @get-bb/plugin-sdk/app 的 definePluginApp 与线程上下文类型; 依赖 components/cockpit/* 的视图
 * [OUTPUT]: 对外提供插件前端入口 (default export): 桌面把 Cockpit 挂进线程上下文卡片 (对话区右上角), 手机与窄窗格挂到输入框上方的横幅, 另注册设置页
 * [POS]: 插件前端注册层, 只做"哪个视图挂到 bb 哪个位置"; 消费者: bb 宿主; 与 components/cockpit 的边界: 本文件不含任何视图逻辑
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import {
  definePluginApp,
  experimental_useThreadContextKind as useThreadContextKind,
  type ExperimentalThreadContextCardProps,
} from "@get-bb/plugin-sdk/app";
import { CockpitGroup, GROUPS, type GroupId } from "./components/cockpit/cockpit";
import { SessionSegmentDetails, SessionSegmentSummary } from "./components/cockpit/compact";
import { mountHostStyles } from "./components/cockpit/host-styles";
import { ChooseDetailsSettings, HostStylesSettings } from "./components/cockpit/settings-section";

/** bb 的分区组件只收到线程信息, 所以每组各做一个绑定了组 id 的组件 */
const groupSection = (group: GroupId) =>
  function CockpitCardSection({ threadId, projectId }: ExperimentalThreadContextCardProps) {
    return <CockpitGroup group={group} threadId={threadId} projectId={projectId} />;
  };

export default definePluginApp((app) => {
  // 对 bb 宿主界面的样式改动 (卡片动效、桌面光标): 内容脚本注入, 与主题无关; 自带失效检测
  app.contentScripts.register({ id: "host-styles", mount: mountHostStyles });

  // 桌面: 每组是卡片里的一个分区 (组名与分隔线由 bb 画), 排在 bb 自己的行 (父线程 / Changes / PR) 之后、Child threads ("1_related") 之前
  GROUPS.forEach((group, index) => {
    app.slots.experimental_threadContextCardSection({
      id: group.id,
      title: group.title,
      group: "0_session",
      order: 10 + index,
      component: groupSection(group.id),
    });
  });

  // 手机与窄窗格: bb 不显示卡片, 同一套内容从输入框上方的摘要点开
  app.slots.experimental_threadContextSegment({
    id: "session",
    title: "Session",
    group: "3_session",
    summary: SessionSegmentSummary,
    details: SessionSegmentDetails,
    useVisible: () => useThreadContextKind() === "banner",
  });

  app.slots.settingsSection({
    id: "host-styles",
    title: "Interface polish",
    description: "Card motion and desktop cursor, applied to bb itself in every theme.",
    component: HostStylesSettings,
  });

  app.slots.settingsSection({
    id: "choose-details",
    title: "Choose details",
    description: "Pick the sections Session Cockpit shows in each thread.",
    component: ChooseDetailsSettings,
  });
});
