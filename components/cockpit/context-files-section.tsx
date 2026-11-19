/**
 * [INPUT]: 依赖 data.ts 的 useContextFiles (工作区的上下文文件: 层级、有无改动、导入) 与 useSession (官方、启动估算和观测读取的实时统计); 依赖 lib/context-files.ts 的合并、分层、就地筛选与分组;
 *          依赖宿主的 useBbNavigate (在 bb 的文件面板里预览 / 用外部编辑器打开)、experimental_useCanOpenFileExternally、copyToClipboard 与脚手架 Dialog
 * [OUTPUT]: 对外提供 ContextFilesSection: Workspace 组里的 Context files 项。收起 = 一行 (已加载数 · 总数, 不知道已加载时只写总数); 点开 = 每个有文件的层级一行; 层级再点开 = 它的文件 (超过 8 个时只就地列已加载与有改动的, 其余进可搜索的弹层)
 * [POS]: components/cockpit 的"哪些文件在给 agent 定规矩"入口 (词汇见 GLOSSARY.md); 消费者: cockpit.tsx; 与 context-section.tsx 的边界: 那边按占用多少列出上下文明细里 Memory files 分类的条目, 这里按层级列出磁盘上全部的上下文文件, 已加载只是其中一个标记
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  experimental_copyToClipboard as copyToClipboard,
  experimental_useCanOpenFileExternally as useCanOpenFileExternally,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  INLINE_LIMIT,
  fileLabel,
  groupByLevel,
  groupByTopDir,
  inlineSelection,
  fileUsageSummary,
  mergeLoaded,
  relativePath,
  type ContextFileView,
  type ContextLevel,
  type DirGroup,
  type LevelGroup,
} from "../../lib/context-files";
import { formatPercent, formatTokens } from "../../lib/format";
import type { SectionProps } from "./cockpit";
import { useContextFiles, useSession } from "./data";
import { CardRow, Collapse, Dot, Hint, MenuItem, SectionBody, SectionRow } from "./rows";

export function ContextFilesSection({ threadId, open, onToggle }: SectionProps) {
  const result = useContextFiles(threadId, open).data;
  const session = useSession(threadId, open).data;
  const files = result?.files;
  const stats = session?.contextFiles;
  const views = useMemo(() => mergeLoaded(files ?? [], stats?.entries ?? null), [files, stats]);
  const hostId = result?.hostId ?? null;
  // 没有任何上下文文件 (或线程还没有工作区) 就不占一行
  if (!hostId || views.length === 0) return null;
  const summary = stats ? fileUsageSummary(stats, session?.context?.windowTokens ?? 0) : null;
  const share = summary?.ratio == null ? "" : ` · ${summary.estimated ? "≈" : ""}${formatPercent(summary.ratio)}`;
  return (
    <div>
      <SectionRow
        icon="FileText"
        label="Context files"
        open={open}
        onToggle={onToggle}
        // 摘要要短: 不知道已加载时只写总数, 不写 "0 loaded"
        summary={summary ? `${summary.count} loaded${share}` : String(views.length)}
      />
      <SectionBody open={open}>
        <Body views={views} hostId={hostId} basis={stats?.basis} />
      </SectionBody>
    </div>
  );
}

const FILE_BASIS_HINT = {
  official: "Loaded from the provider snapshot and file reads since the last context reset. Observed read sizes are estimated.",
  estimated: "Loaded status estimated from startup rules and file reads since the last context reset.",
  observed: "Based on file reads since the last context reset. The provider has not reported loaded files.",
};

function Body({ views, hostId, basis }: { views: ContextFileView[]; hostId: string; basis?: keyof typeof FILE_BASIS_HINT }) {
  // 层级的展开状态只留在组件里: 它是"这一眼想看哪层", 不值得记进偏好
  const [expanded, setExpanded] = useState<ContextLevel[]>([]);
  const [dialogLevel, setDialogLevel] = useState<ContextLevel | null>(null);
  const groups = useMemo(() => groupByLevel(views), [views]);
  return (
    <div>
      {groups.map((group) => (
        <Level
          key={group.level}
          group={group}
          hostId={hostId}
          open={expanded.includes(group.level)}
          onToggle={() => setExpanded(expanded.includes(group.level) ? expanded.filter((level) => level !== group.level) : [...expanded, group.level])}
          onShowAll={() => setDialogLevel(group.level)}
        />
      ))}
      <Hint>{basis ? FILE_BASIS_HINT[basis] : "Loaded: unknown"}</Hint>
      <FilesDialog group={groups.find((group) => group.level === dialogLevel) ?? null} hostId={hostId} onClose={() => setDialogLevel(null)} />
    </div>
  );
}

/** 有未提交改动的标记; 橙色在卡片里原本只表示额度告警, 这里借用 git 的 M 字母来区分 */
function ChangedMark() {
  return (
    <span className="text-[11px] font-medium leading-none" style={{ color: "var(--warning)" }} title="Uncommitted changes" role="img" aria-label="Uncommitted changes">
      M
    </span>
  );
}

/** 文件行右侧: 已加载时的 token 数与绿点, 有改动时的 M; 都没有就什么也不画 */
function fileMarks(file: ContextFileView): ReactNode {
  if (file.loaded !== true && !file.changed) return null;
  return (
    <>
      {file.loaded === true && file.tokens !== null ? <span>{file.source && file.source !== "official" ? "≈" : ""}{formatTokens(file.tokens)}</span> : null}
      {file.loaded === true ? <Dot color="var(--success)" label={file.source === "read" ? "Read since last context reset" : file.source === "startup" ? "Estimated startup file" : "Loaded in provider snapshot"} /> : null}
      {file.changed ? <ChangedMark /> : null}
    </>
  );
}

/**
 * 行上的名字。目录路径 (模块、子目录里的本地私有) 放不下时从中间省略: 最后一段才说明是哪个目录,
 * 所以它和后缀不参与截断, 只截前面的上级路径 (apps/web/src/comp…/chart)。文件名照常从末尾截。
 */
function FileLabel({ file }: { file: ContextFileView }) {
  const { text, suffix } = fileLabel(file);
  const cut = file.dir !== "" && text === file.dir ? text.lastIndexOf("/") : -1;
  return (
    <span className="flex min-w-0">
      <span className="min-w-0 truncate">{cut > 0 ? text.slice(0, cut) : text}</span>
      {cut > 0 ? <span className="shrink-0">{text.slice(cut)}</span> : null}
      {suffix ? <span className="shrink-0 whitespace-pre text-muted-foreground"> · {suffix}</span> : null}
    </span>
  );
}

/** 一个层级: 读数行 (名称 + 个数 + 已加载数 + 有改动标记 + 箭头), 点开就地列出它的文件 */
function Level({ group, hostId, open, onToggle, onShowAll }: { group: LevelGroup; hostId: string; open: boolean; onToggle: () => void; onShowAll: () => void }) {
  const { files, showAll } = inlineSelection(group, INLINE_LIMIT);
  return (
    <div>
      <CardRow
        stat
        label={group.label}
        expanded={open}
        onClick={onToggle}
        trailing={
          <>
            <span>{group.total}</span>
            {group.loaded !== null ? <span className="text-muted-foreground">· {group.loaded} loaded</span> : null}
            {group.changed > 0 ? <ChangedMark /> : null}
            <Icon name="ChevronRight" className={cn("size-3 text-muted-foreground transition-transform duration-150", open && "rotate-90")} aria-hidden />
          </>
        }
      />
      <Collapse open={open}>
        <div className="pb-0.5 pl-3">
          {files.map((file) => (
            <div key={file.path}>
              <FileRow hostId={hostId} path={file.path} name={relativePath(file)} label={<FileLabel file={file} />} trailing={fileMarks(file)} />
              {/* 导入跟随导入它的文件: 紧贴在下面再缩进一格, 不单独成为一个层级 */}
              {file.imports.length > 0 ? (
                <div className="pl-3">
                  {file.imports.map((imported) => (
                    <FileRow key={imported.path} hostId={hostId} path={imported.path} name={imported.name} label={`↳ ${imported.name}`} />
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {showAll ? <CardRow muted label={`All ${group.total} · search`} onClick={onShowAll} /> : null}
        </div>
      </Collapse>
    </div>
  );
}

/** 文件行: 行体在 bb 的文件面板里预览; 行尾菜单里可以用外部编辑器单独打开、复制路径 */
function FileRow({ hostId, path, name, label, trailing }: { hostId: string; path: string; name: string; label: ReactNode; trailing?: ReactNode }) {
  const navigate = useBbNavigate();
  const target = { kind: "host" as const, hostId, path };
  const canOpenExternally = useCanOpenFileExternally(target);
  const preview = () => void navigate.experimental_openFilePreview({ target, location: null });
  return (
    <CardRow
      quietMenu
      label={label}
      title={path}
      trailing={trailing}
      onClick={preview}
      menuLabel={`Actions for ${name}`}
      menu={
        <>
          <MenuItem icon="PanelRight" label="Open in panel" onSelect={preview} />
          {canOpenExternally ? (
            <MenuItem icon="ExternalLink" label="Open in editor" onSelect={() => void navigate.experimental_openFileExternally({ target, location: null })} />
          ) : null}
          <MenuItem icon="Copy" label="Copy path" onSelect={() => void copyToClipboard({ text: path }).then((ok) => ok && toast.success("Copied"))} />
        </>
      }
    />
  );
}

/**
 * 一个层级的全部文件 (几十个模块、很多条自动记忆), 只在就地列不下时才用。桌面是居中弹层, 手机是底部抽屉 (脚手架 Dialog 的响应式行为)。
 * 模块按顶层目录分组; 分组用全量文件算好后再过滤, 输入时各组不会跳来跳去。点一个文件: 预览并关掉弹层。
 */
function FilesDialog({ group, hostId, onClose }: { group: LevelGroup | null; hostId: string; onClose: () => void }) {
  const navigate = useBbNavigate();
  const [query, setQuery] = useState("");
  const close = () => {
    onClose();
    setQuery("");
  };
  const sections = useMemo((): DirGroup[] => {
    if (!group) return [];
    const q = query.trim().toLowerCase();
    const all: DirGroup[] = group.level === "modules" ? groupByTopDir(group.files) : [{ name: "", files: group.files }];
    return all
      .map((section) => ({ name: section.name, files: section.files.filter((file) => q === "" || relativePath(file).toLowerCase().includes(q)) }))
      .filter((section) => section.files.length > 0);
  }, [group, query]);
  return (
    <Dialog open={group !== null} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-md gap-3">
        {group ? (
          <>
            <DialogHeader>
              <DialogTitle>{group.label}</DialogTitle>
              <DialogDescription>
                {group.total} context files
                {group.loaded ? ` · ${group.loaded} loaded` : ""}
                {group.changed > 0 ? ` · ${group.changed} changed` : ""}
              </DialogDescription>
            </DialogHeader>
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by path" aria-label="Filter by path" className="h-8 text-sm" />
            <div className="-mx-2 max-h-[50dvh] min-h-24 overflow-y-auto">
              {sections.map((section) => (
                <section key={section.name}>
                  {section.name !== "" ? (
                    <h4 className="flex items-baseline gap-1.5 px-2 pb-0.5 pt-2.5 text-xs text-muted-foreground">
                      {section.name}
                      <span className="tabular-nums">{section.files.length}</span>
                    </h4>
                  ) : null}
                  {section.files.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      className="flex min-h-7 w-full min-w-0 items-center gap-3 rounded-md px-2 py-0.5 text-left text-sm hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-none active:scale-100 active:bg-state-active pointer-coarse:min-h-9"
                      title={file.path}
                      onClick={() => {
                        void navigate.experimental_openFilePreview({ target: { kind: "host", hostId, path: file.path }, location: null });
                        close();
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <FileLabel file={file} />
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">{fileMarks(file)}</span>
                    </button>
                  ))}
                </section>
              ))}
              {sections.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No matches</p> : null}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
