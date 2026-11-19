/**
 * [INPUT]: 依赖当前语言及 依赖宿主图标 (components/ui/icon) 与 lib/palette.ts 的色调
 * [OUTPUT]: 对外提供 SectionRow / SectionBody (分区展开内容统一缩进到名称线) / Collapse / CardRow (行体主操作 + 箭头菜单) / MenuItem / MenuConfirmItem / MoreRow / Meter / Hint / Dot / toneVar: 卡片与横幅详情共用的行式原语 (触屏下行高 36px、操作常显)
 * [POS]: components/cockpit 的展示原语层; 尺寸照抄 bb 原生卡片行 (26px 行高、12px 字、14px 灰色图标、右侧灰色等宽数字);
 *        消费者: 本目录各分区; 与 components/ui 的边界: ui 是脚手架通用组件, 本文件只服务卡片
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useText } from "./language";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { Tone } from "../../lib/palette";

/**
 * 动效参数。取值依据: Claude Desktop 与 T3 Code 的折叠面板都是 200ms + ease-out, 并在系统开启"减少动态效果"时关闭;
 * 缓动优先用宿主主题的 --glass-ease, 没有主题时回落到 Claude Desktop 的 ease-out 曲线。
 */
export const EASE = "var(--glass-ease, cubic-bezier(0.165, 0.84, 0.44, 1))";
const COLLAPSE_MS = 200;
const FADE_MS = 160;
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * 高度未知内容的展开/收起: grid 行从 0fr 过渡到 1fr (与 bb 原生横幅详情同一技法), 同时淡入淡出。
 * 收起动画结束后才卸载子树, 所以"按需渲染"不受影响。
 */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const [rendered, setRendered] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const ref = useRef<HTMLDivElement>(null);
  // 展开: 渲染期间就挂载 (不等下一帧), 挂载后强制算一次 0fr 的样式, 同一帧内切到 1fr 开始过渡
  if (open && !rendered) setRendered(true);
  useLayoutEffect(() => {
    if (rendered && open && !expanded) {
      void ref.current?.offsetHeight;
      setExpanded(true);
    }
  }, [rendered, open, expanded]);
  useEffect(() => {
    if (open) return;
    setExpanded(false);
    if (reducedMotion()) setRendered(false);
  }, [open]);
  if (!rendered) return null;
  return (
    <div
      ref={ref}
      inert={!expanded}
      style={{
        display: "grid",
        gridTemplateRows: expanded ? "1fr" : "0fr",
        opacity: expanded ? 1 : 0,
        transition: reducedMotion() ? "none" : `grid-template-rows ${COLLAPSE_MS}ms ${EASE}, opacity ${FADE_MS}ms ease-out`,
      }}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === "grid-template-rows" && !open) setRendered(false);
      }}
    >
      <div style={{ overflow: "hidden", minHeight: 0 }}>{children}</div>
    </div>
  );
}

/**
 * 第二层的容器: 分区展开后的全部内容。整体缩进到"分区名称"那条竖线上 (图标留在左侧的槽里),
 * 于是整张卡片只有两条左对齐线: 名称线 (分区名、读数名、说明文字) 和它右边一格的条目线 (阶段名、分类名、服务名)。
 * 不画引导线: 阶段轨道、分类明细自己有竖线, 再加一条就是两条并排。所有分区都用它, 层级的画法只此一处。
 */
export function SectionBody({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <Collapse open={open}>
      <div className="mb-2 ml-[22px]">{children}</div>
    </Collapse>
  );
}

export const toneVar = (tone: Tone): string =>
  tone === "danger" ? "var(--destructive)" : tone === "warning" ? "var(--warning)" : "var(--muted-foreground)";

/**
 * 卡片行。与 bb 原生行同尺寸; 整行按钮不做按压缩放 (用户主题对按钮有 active 缩放, 宽行缩进观感过猛), 改用按下时背景加深。
 *
 * 一行两个点击区 (T3 Code 的做法): 行体执行主操作 onClick; 传了 menu 时右侧多一个独立的箭头按钮,
 * 点它在行下方展开菜单放次要操作。两个区各有自己的悬停底色, 不会点错。
 * 既没有 onClick 也没有 menu 的行是纯信息: 没有悬停底色。
 *
 * 放不下时谁让位: 默认右侧数值完整显示、名称截断; priority="label" 反过来 (名称完整, 右侧截断),
 * 用于名称本身是关键信息、右侧只是归属说明的行 (如 Server 行的地址)。
 */
export function CardRow({
  icon,
  leading,
  label,
  trailing,
  menu,
  menuLabel,
  onClick,
  title,
  muted,
  stat,
  quietMenu,
  expanded,
  priority = "trailing",
}: {
  icon?: string;
  leading?: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
  /** DropdownMenuItem 列表 */
  menu?: ReactNode;
  menuLabel?: string;
  onClick?: () => void;
  title?: string;
  muted?: boolean;
  /** 读数行 (名称: 数值): 名称退后成灰色, 数值用正文色; 与"名称是主角"的条目行 (服务、脚本) 相反 */
  stat?: boolean;
  /** 菜单箭头平时不显示, 悬停或聚焦这一行时才出现 (触屏常显): 一列文件行每行一个箭头会很吵, 还容易和"可展开"的箭头混 */
  quietMenu?: boolean;
  expanded?: boolean;
  priority?: "label" | "trailing";
}) {
  const t = useText();
  const labelFirst = priority === "label";
  const body = (
    <>
      {leading ??
        (icon ? (
          <Icon name={icon} fallback="Circle" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : null)}
      <span className={cn("min-w-0 truncate", labelFirst ? "max-w-[75%] shrink-0" : "flex-1", (muted || stat) && "text-muted-foreground")}>{label}</span>
      {trailing !== undefined && trailing !== null ? (
        labelFirst ? (
          <span className="ml-auto min-w-0 flex-1 truncate text-right text-xs tabular-nums text-muted-foreground">{trailing}</span>
        ) : (
          <span className={cn("ml-auto flex shrink-0 items-center gap-1 text-xs tabular-nums", stat ? "text-foreground" : "text-muted-foreground")}>{trailing}</span>
        )
      ) : null}
    </>
  );
  const inner = cn("flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-xs text-foreground", menu ? "rounded-l-md" : "rounded-md");
  return (
    <div className="group/row flex h-6.5 w-full min-w-0 items-stretch rounded-md pointer-coarse:h-9" title={title}>
      {onClick ? (
        <button
          type="button"
          className={cn(inner, "hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-none active:scale-100 active:bg-state-active")}
          onClick={onClick}
          aria-expanded={expanded}
        >
          {body}
        </button>
      ) : (
        <div className={inner}>{body}</div>
      )}
      {menu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn("flex w-6 shrink-0 items-center justify-center rounded-r-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:bg-state-hover focus-visible:outline-none active:scale-100 data-[state=open]:bg-state-active data-[state=open]:text-foreground pointer-coarse:w-9", quietMenu && "opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100")}
              aria-label={menuLabel ?? t("moreActions")}
            >
              <Icon name="ChevronDown" className="size-3" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={4} className="min-w-44">
            {menu}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

/** 菜单项 (带图标) */
export function MenuItem({ icon, label, onSelect }: { icon: string; label: string; onSelect: () => void }) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="gap-2 text-xs">
      <Icon name={icon} fallback="Circle" className="size-3.5 text-muted-foreground" aria-hidden />
      {label}
    </DropdownMenuItem>
  );
}

/**
 * 两步确认的危险菜单项: 第一次选中不关菜单, 文案变成确认语; 再选一次才执行。
 * 菜单关闭后状态随组件卸载复位。
 */
export function MenuConfirmItem({ icon, label, confirmLabel, onConfirm }: { icon: string; label: string; confirmLabel: string; onConfirm: () => void | Promise<void> }) {
  const [armed, setArmed] = useState(false);
  return (
    <DropdownMenuItem
      variant="destructive"
      className="gap-2 text-xs"
      onSelect={(event) => {
        if (!armed) {
          event.preventDefault();
          setArmed(true);
          return;
        }
        void onConfirm();
      }}
    >
      <Icon name={armed ? "Check" : icon} fallback="Circle" className="size-3.5" aria-hidden />
      {armed ? confirmLabel : label}
    </DropdownMenuItem>
  );
}

/** "Show N more / Show less" 折叠行; 传 label 时作为固定标题的展开行 (如 "Token details") */
export function MoreRow({ count = 0, label, open, onToggle }: { count?: number; label?: string; open: boolean; onToggle: () => void }) {
  const t = useText();
  return (
    <CardRow
      leading={
        <Icon
          name="ChevronRight"
          className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-90")}
          aria-hidden
        />
      }
      label={label ?? (open ? t("showLess") : t("showMore", { count }))}
      muted
      expanded={open}
      onClick={onToggle}
    />
  );
}

/** 细进度条 */
export function Meter({ ratio, tone = "normal", className }: { ratio: number; tone?: Tone; className?: string }) {
  const width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  return (
    <span className={cn("block h-1 overflow-hidden rounded-full bg-muted", className)}>
      <span
        className="block h-full rounded-full transition-[width] duration-300"
        style={{ width, background: tone === "normal" ? "var(--foreground)" : toneVar(tone), opacity: tone === "normal" ? 0.5 : 1 }}
      />
    </span>
  );
}

/** 行下方的一句提示 (11px) */
export function Hint({ children, tone = "normal" }: { children: ReactNode; tone?: Tone }) {
  return (
    <p className="px-2 pb-1 text-[11px] leading-4 text-muted-foreground" style={tone === "normal" ? undefined : { color: toneVar(tone) }}>
      {children}
    </p>
  );
}

export function Dot({ color, label }: { color: string; label?: string }) {
  return (
    <span
      className="inline-block size-1.5 shrink-0 rounded-full"
      style={{ background: color }}
      role={label ? "img" : undefined}
      aria-label={label}
    />
  );
}

/**
 * 第一层: 一项只占一行 (图标 + 名称 + 右侧摘要 + 箭头), 点击就地展开它的全部细节。
 * 与 CardRow、bb 原生行同尺寸同字重。
 * leading 换掉图标 (Progress 用阶段标记); priority="label" 时名称可截断、摘要完整 (名称是一句话的行)。
 * data-cockpit-item 供分组容器判断"这一组有没有内容" (没有就连标题一起隐藏)。
 */
export function SectionRow({
  icon,
  leading,
  label,
  summary,
  open,
  onToggle,
  priority = "summary",
  title,
}: {
  icon?: string;
  leading?: ReactNode;
  label: string;
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  priority?: "label" | "summary";
  title?: string;
}) {
  const labelFirst = priority === "label";
  return (
    <button
      type="button"
      data-cockpit-item=""
      className="flex h-6.5 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs text-foreground hover:bg-state-hover focus-visible:bg-state-hover focus-visible:outline-none active:scale-100 active:bg-state-active pointer-coarse:h-9"
      onClick={onToggle}
      aria-expanded={open}
      title={title}
    >
      {leading ?? (icon ? <Icon name={icon} fallback="Circle" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null)}
      {/* 名称用常规字重, 和 bb 自己的行 (Changes、子线程) 一致: 层级由组名和缩进表达, 不靠加粗 */}
      <span className={labelFirst ? "min-w-0 flex-1 truncate" : "shrink-0"}>{label}</span>
      <span className={cn("ml-auto flex items-center gap-1 tabular-nums text-muted-foreground", labelFirst ? "shrink-0" : "min-w-0 truncate")}>{summary}</span>
      <Icon
        name="ChevronRight"
        className={cn("size-3 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-90")}
        aria-hidden
      />
    </button>
  );
}
