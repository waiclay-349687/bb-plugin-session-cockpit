/**
 * [INPUT]: 依赖 prefs.ts (隐藏的分区、当前展开的分区) 与本目录各分区组件
 * [OUTPUT]: 对外提供 GROUPS (分组定义)、CockpitGroup (一组里的各项, 桌面卡片每组一个 bb 分区)、Cockpit (全部分组自带组名, 横幅详情用) 与 SectionProps
 * [POS]: components/cockpit 的组合层: 内容按组排列 (Progress / Usage / Workspace), 每一项默认只占一行, 点击就地展开细节 (可同时展开多个, 超出卡片高度时在卡片内滚动), 更长的列表由分区自己开弹层;
 *        消费者: app.tsx 的 threadContextCardSection 与 compact.tsx 的横幅详情; 与各分区的边界: 本文件只管分组、顺序、显隐与展开状态
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import type { ComponentType } from "react";
import { ContextFilesSection } from "./context-files-section";
import { ContextSection } from "./context-section";
import { ConnectorsSection, ScriptsSection, ServersSection, SideChatsSection } from "./list-sections";
import { usePrefs, type SectionId } from "./prefs";
import { ProgressSection } from "./progress-section";
import { UsageSection } from "./usage-section";

export interface SectionProps {
  threadId: string;
  projectId: string;
  open: boolean;
  onToggle: () => void;
}

/** 与 prefs.ts 的 SECTION_DEFS 一一对应; Record 保证新增分区时这里不会漏 */
const SECTIONS: Record<SectionId, ComponentType<SectionProps>> = {
  progress: ProgressSection,
  context: ContextSection,
  usage: UsageSection,
  servers: ServersSection,
  scripts: ScriptsSection,
  contextFiles: ContextFilesSection,
  connectors: ConnectorsSection,
  sideChats: SideChatsSection,
};

/**
 * 分组是卡片排版的唯一真相源: 组的顺序 = 重要程度 (这条对话到哪了 → 还能不能继续用 → 手边的工具),
 * 每一项默认只占一行, 细节点开才看; 组名不在组里的行上重复。
 * 桌面: 每组注册成 bb 卡片里的一个分区 (app.tsx), 组名和组间分隔线由 bb 画;
 * 手机与窄窗格的横幅里没有 bb 的分区标题, 由 Cockpit 自己画同一份分组。
 */
export const GROUPS = [
  { id: "progress", title: "Progress", sections: ["progress"] },
  { id: "usage", title: "Usage", sections: ["context", "usage"] },
  { id: "workspace", title: "Workspace", sections: ["servers", "scripts", "contextFiles", "connectors", "sideChats"] },
] as const satisfies readonly { id: string; title: string; sections: readonly SectionId[] }[];

export type GroupId = (typeof GROUPS)[number]["id"];

/** 一组里的各项 (不含组名) */
export function CockpitGroup({ group, threadId, projectId }: { group: GroupId; threadId: string; projectId: string }) {
  const { prefs, isHidden, toggleOpen } = usePrefs();
  const sections: readonly SectionId[] = GROUPS.find((g) => g.id === group)?.sections ?? [];
  return (
    <>
      {sections
        .filter((id) => !isHidden(id))
        .map((id) => {
          const Section = SECTIONS[id];
          return <Section key={id} threadId={threadId} projectId={projectId} open={prefs.open.includes(id)} onToggle={() => toggleOpen(id)} />;
        })}
    </>
  );
}

/** 全部分组, 自带组名与分隔线 (横幅详情用); 一组里没有任何一项时整组连组名一起隐藏 */
export function Cockpit({ threadId, projectId }: { threadId: string; projectId: string }) {
  return (
    <div>
      {GROUPS.map((group) => (
        <section key={group.id} className="hidden border-t border-border py-1.5 first:border-t-0 first:pt-0 has-[[data-cockpit-item]]:block">
          <h3 className="px-2 pb-0.5 text-xs text-muted-foreground">{group.title}</h3>
          <CockpitGroup group={group.id} threadId={threadId} projectId={projectId} />
        </section>
      ))}
    </div>
  );
}
