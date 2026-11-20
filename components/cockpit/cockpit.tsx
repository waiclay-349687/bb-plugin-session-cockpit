/**
 * [INPUT]: 依赖 prefs.ts 的顺序、语言覆盖和各板块组件
 * [OUTPUT]: 提供 Cockpit：桌面卡片和手机横幅共用的有序板块树，以及 SectionProps。
 * [POS]: 按用户顺序渲染，仅为相邻且同语言的同组板块共享标题。
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { effectiveSectionLanguage } from "../../lib/cockpit-prefs";
import { textFor, type Language } from "../../lib/i18n";
import { SectionLanguageProvider, useLanguage } from "./language";
import type { ComponentType } from "react";
import { ContextFilesSection } from "./context-files-section";
import { ContextSection } from "./context-section";
import { EnvironmentSection } from "./environment-section";
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
  environment: EnvironmentSection,
  progress: ProgressSection,
  context: ContextSection,
  usage: UsageSection,
  servers: ServersSection,
  scripts: ScriptsSection,
  contextFiles: ContextFilesSection,
  connectors: ConnectorsSection,
  sideChats: SideChatsSection,
};

const GROUP_OF = {
  environment: null, progress: "progress", context: "usage", usage: "usage",
  servers: "workspace", scripts: "workspace", contextFiles: "workspace",
  connectors: "workspace", sideChats: "workspace",
} as const satisfies Record<SectionId, "progress" | "usage" | "workspace" | null>;

type Group = { title: (typeof GROUP_OF)[SectionId]; language: Language; sections: SectionId[] };

/** 仅把相邻、同组且同语言的行放在一起；跨组拖动不会被标题反向重排。 */
export function Cockpit({ threadId, projectId }: { threadId: string; projectId: string }) {
  const global = useLanguage();
  const { prefs, isHidden, toggleOpen } = usePrefs();
  const groups: Group[] = [];
  for (const id of prefs.order) {
    if (isHidden(id)) continue;
    const title = GROUP_OF[id];
    const language = effectiveSectionLanguage(global, prefs.sectionLanguages, id);
    const last = groups.at(-1);
    if (last?.title === title && last.language === language) last.sections.push(id);
    else groups.push({ title, language, sections: [id] });
  }

  return (
    <div className="min-w-0" data-cockpit-layout>
      {groups.map(({ title, language, sections }) => (
        <section
          key={sections[0]}
          lang={language === "zh" ? "zh-CN" : "en"}
          className="hidden py-1.5 has-[[data-cockpit-item]]:block [&:has([data-cockpit-item])~&:has([data-cockpit-item])]:border-t [&:has([data-cockpit-item])~&:has([data-cockpit-item])]:border-border"
        >
          {title ? <h3 className="px-2 pb-0.5 text-xs font-medium text-muted-foreground">{textFor[language](title)}</h3> : null}
          <SectionLanguageProvider lang={language}>
            {sections.map(id => {
              const Section = SECTIONS[id];
              return (
                <div key={id} data-cockpit-section={id} className="contents">
                  <Section threadId={threadId} projectId={projectId} open={prefs.open.includes(id)} onToggle={() => toggleOpen(id)} />
                </div>
              );
            })}
          </SectionLanguageProvider>
        </section>
      ))}
    </div>
  );
}
