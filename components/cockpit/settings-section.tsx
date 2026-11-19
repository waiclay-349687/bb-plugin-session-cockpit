/**
 * [INPUT]: 依赖 prefs.ts 的 SECTION_DEFS 与 usePrefs、host-styles.ts 的自检结果、脚手架 Checkbox
 * [OUTPUT]: 对外提供 ChooseDetailsSettings (显示哪些分区) 与 HostStylesSettings (宿主样式开关 + 自检状态 + 修复办法)
 * [POS]: components/cockpit 的设置视图; 消费者: app.tsx 的 settingsSection; 与各分区的边界: 卡片高度有限, 开关不放进卡片本身
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useEffect, useState } from "react";
import { experimental_copyToClipboard as copyToClipboard } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { FIX_PROMPT, recheckHostHealth, useHostHealth, type HookResult } from "./host-styles";
import { SECTION_DEFS, usePrefs, type HostStyleBlock } from "./prefs";

export function ChooseDetailsSettings() {
  const { isHidden, toggleHidden, reset } = usePrefs();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Sections shown in each thread: in the context card at the upper right on desktop, and from the summary above the composer on phones. Stored on this device.
      </p>
      <div className="space-y-2">
        {SECTION_DEFS.map((section) => (
          <label key={section.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={!isHidden(section.id)} onCheckedChange={() => toggleHidden(section.id)} />
            {section.label}
          </label>
        ))}
      </div>
      <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={reset}>
        Reset to defaults
      </button>
    </div>
  );
}

const STATUS_TEXT: Record<HookResult["status"], string> = { ok: "Working", broken: "Stopped working", skipped: "Not checked", off: "Off" };
const STATUS_COLOR: Record<HookResult["status"], string> = {
  ok: "var(--success)",
  broken: "var(--destructive)",
  skipped: "var(--muted-foreground)",
  off: "var(--muted-foreground)",
};

export function HostStylesSettings() {
  const { prefs, toggleHostStyle } = usePrefs();
  const { results, checkedAt } = useHostHealth();
  // 开关后立即复查, 关掉的显示 Off, 不留着上一次的"Stopped working"
  const toggle = (block: HostStyleBlock) => {
    toggleHostStyle(block);
    recheckHostHealth();
  };
  const [, force] = useState(0);
  // 打开设置页时查一次; 设置页上没有线程视图, 显示的是最近一次在线程页上得到的结论
  useEffect(() => {
    recheckHostHealth();
  }, []);
  const broken = results.filter((r) => r.status === "broken");
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        These change bb's own interface, in every theme. They rely on parts of bb that can change in an update; when one stops matching, bb falls back to its stock behavior and you get a notice here and as a toast.
      </p>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={prefs.hostStyles.cardMotion} onCheckedChange={() => toggle("cardMotion")} />
          Thread context card motion: slide in, shift the transcript smoothly, keep the history rail beside the card
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={prefs.hostStyles.desktopCursor} onCheckedChange={() => toggle("desktopCursor")} />
          Desktop cursor: arrow on buttons, tabs and rows; hand only on links; message text keeps the text cursor
        </label>
      </div>
      <div className="rounded-md border border-border p-2.5">
        <div className="flex items-center gap-2 pb-1.5 text-xs text-muted-foreground">
          <span className="flex-1">
            Health check{checkedAt ? ` · ${new Date(checkedAt).toLocaleTimeString()}` : ""} · checked automatically while a thread is open
          </span>
          <button
            type="button"
            className="rounded border border-border px-1.5 py-0.5 hover:bg-state-hover"
            onClick={() => {
              recheckHostHealth();
              force((n) => n + 1);
            }}
          >
            Check now
          </button>
        </div>
        {results.map((r) => (
          <div key={r.id} className="flex items-baseline gap-2 py-0.5 text-sm">
            <span className="size-1.5 shrink-0 translate-y-[-2px] rounded-full" style={{ background: STATUS_COLOR[r.status] }} />
            <span className="min-w-0 flex-1">
              {r.label}
              {r.status === "broken" ? <span className="block text-xs text-muted-foreground">{r.detail}</span> : null}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{STATUS_TEXT[r.status]}</span>
          </div>
        ))}
        {broken.length > 0 ? (
          <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
            <p>
              To fix: paste the prompt into any bb thread and an agent will update the plugin for the new bb. Until then, turn the affected option off above to stop the notices.
            </p>
            <button
              type="button"
              className="mt-1.5 rounded border border-border px-1.5 py-0.5 text-foreground hover:bg-state-hover"
              onClick={() =>
                void copyToClipboard({ text: `${FIX_PROMPT}\n${broken.map((r) => `- ${r.id}: ${r.detail}`).join("\n")}` }).then(
                  (ok) => ok && toast.success("Copied"),
                )
              }
            >
              Copy fix prompt
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
