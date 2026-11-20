/**
 * [INPUT]: 依赖 @get-bb/plugin-sdk/app 的 definePluginApp 与线程上下文类型; 依赖 components/cockpit/* 的视图
 * [OUTPUT]: 对外提供插件前端入口 (default export): 桌面把 Cockpit 挂进线程上下文卡片 (对话区右上角; 一个宿主槽位内的九个可排序板块), 手机与窄窗格挂到输入框上方的横幅, 另注册语言同步和设置页
 * [POS]: 插件前端注册层, 只做"哪个视图挂到 bb 哪个位置"; 消费者: bb 宿主; 与 components/cockpit 的边界: 本文件不含任何视图逻辑
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import {
  definePluginApp,
  experimental_useThreadContextKind as useThreadContextKind,
  type ExperimentalThreadContextCardProps,
} from "@get-bb/plugin-sdk/app";
import { Cockpit } from "./components/cockpit/cockpit";
import { SessionSegmentDetails, SessionSegmentSummary } from "./components/cockpit/compact";
import { BriefingSettings } from "./components/cockpit/briefing-settings";
import { currentText, LanguageSync } from "./components/cockpit/language";
import { mountHostStyles, useHostHeading } from "./components/cockpit/host-styles";
import { ChooseDetailsSettings, DisplaySettings, HostStylesSettings, LanguageSettings } from "./components/cockpit/settings-section";

function CockpitCard({ threadId, projectId }: ExperimentalThreadContextCardProps) {
  const heading = useHostHeading("session");
  return <>
    <span hidden data-bb-plugin-root="" data-bb-plugin="session-cockpit" data-cockpit-group-heading="session" ref={heading} />
    <Cockpit threadId={threadId} projectId={projectId} />
  </>;
}

export default definePluginApp((app) => {
  // 对 bb 宿主界面的样式改动 (卡片动效、桌面光标): 内容脚本注入, 与主题无关; 自带失效检测
  app.contentScripts.register({ id: "host-styles", mount: mountHostStyles });

  app.slots.experimental_appOverlay({ id: "language-sync", component: LanguageSync });
  app.slots.experimental_threadContextCardSection({
    id: "cockpit",
    title: currentText()("session"),
    group: "0_session",
    order: 10,
    component: CockpitCard,
  });

  // 手机与窄窗格: bb 不显示卡片, 同一套内容从输入框上方的摘要点开
  app.slots.experimental_threadContextSegment({
    id: "session",
    title: currentText()("session"),
    group: "3_session",
    summary: SessionSegmentSummary,
    details: SessionSegmentDetails,
    useVisible: () => useThreadContextKind() === "banner",
  });

  app.slots.settingsSection({ id: "language", component: LanguageSettings });
  app.slots.settingsSection({ id: "host-styles", component: HostStylesSettings });
  app.slots.settingsSection({ id: "choose-details", component: ChooseDetailsSettings });
  app.slots.settingsSection({ id: "display", component: DisplaySettings });
  app.slots.settingsSection({ id: "progress-briefing", component: BriefingSettings });
});
