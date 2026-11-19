/**
 * [INPUT]: 依赖 prefs.ts 的 SECTION_DEFS 与 usePrefs、host-styles.ts 的自检结果、脚手架 Checkbox
 * [OUTPUT]: 提供语言选择器及 对外提供 ChooseDetailsSettings (显示哪些分区) 与 HostStylesSettings (宿主样式开关 + 自检状态 + 修复办法)
 * [POS]: components/cockpit 的设置视图; 消费者: app.tsx 的 settingsSection; 与各分区的边界: 卡片高度有限, 开关不放进卡片本身
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useText, useLanguage, useLanguageMode, notifyCockpit } from "./language";
import { useEffect, useState } from "react";
import { experimental_copyToClipboard as copyToClipboard } from "@get-bb/plugin-sdk/app";
import { languageMode } from "../../lib/i18n";
import { Checkbox } from "@/components/ui/checkbox";
import { repairPrompt, recheckHostHealth, useHostHealth, useHostSettingsChrome, type HookResult } from "./host-styles";
import { SECTION_DEFS, usePrefs, type HostStyleBlock } from "./prefs";

export function ChooseDetailsSettings() {
  const t = useText();
  const { isHidden, toggleHidden, reset } = usePrefs();
  return (
    <div className="space-y-3" data-cockpit-settings>
      <h3 className="text-sm font-medium">{t("chooseDetails")}</h3>
      <p className="text-sm text-muted-foreground">
        {t("sectionsHelp")}
      </p>
      <div className="space-y-2">
        {SECTION_DEFS.map((section) => (
          <label key={section.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={!isHidden(section.id)} onCheckedChange={() => toggleHidden(section.id)} />
            {t(section.label)}
          </label>
        ))}
      </div>
      <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={reset}>
        {t("reset")}
      </button>
    </div>
  );
}

const STATUS_TEXT = { ok: "healthOk", broken: "healthBroken", skipped: "healthSkipped", off: "healthOff" } as const;
const STATUS_COLOR: Record<HookResult["status"], string> = {
  ok: "var(--success)",
  broken: "var(--destructive)",
  skipped: "var(--muted-foreground)",
  off: "var(--muted-foreground)",
};

export function HostStylesSettings() {
  const t = useText();
  const language = useLanguage();
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
    <div className="space-y-3" data-cockpit-settings>
      <h3 className="text-sm font-medium">{t("hostPolish")}</h3>
      <p className="text-sm text-muted-foreground">
        {t("polishHelp")}
      </p>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={prefs.hostStyles.cardMotion} onCheckedChange={() => toggle("cardMotion")} />
          {t("cardMotion")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={prefs.hostStyles.desktopCursor} onCheckedChange={() => toggle("desktopCursor")} />
          {t("desktopCursor")}
        </label>
      </div>
      <div className="rounded-md border border-border p-2.5">
        <div className="flex items-center gap-2 pb-1.5 text-xs text-muted-foreground">
          <span className="flex-1">
            {t("healthCheck")}{checkedAt ? ` · ${new Date(checkedAt).toLocaleTimeString(language === "zh" ? "zh-CN" : "en-US")}` : ""} · {t("checkedAutomatically")}
          </span>
          <button
            type="button"
            className="rounded border border-border px-1.5 py-0.5 hover:bg-state-hover"
            onClick={() => {
              recheckHostHealth();
              force((n) => n + 1);
            }}
          >
            {t("checkNow")}
          </button>
        </div>
        {results.map((r) => (
          <div key={r.id} className="flex items-baseline gap-2 py-0.5 text-sm">
            <span className="size-1.5 shrink-0 translate-y-[-2px] rounded-full" style={{ background: STATUS_COLOR[r.status] }} />
            <span className="min-w-0 flex-1">
              {t(r.label)}
              {r.status === "broken" ? <span className="block text-xs text-muted-foreground">{t(r.detail ?? "checkFailed")}</span> : null}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{t(STATUS_TEXT[r.status])}</span>
          </div>
        ))}
        {broken.length > 0 ? (
          <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
            <p>
              {t("fixHelp")}
            </p>
            <button
              type="button"
              className="mt-1.5 rounded border border-border px-1.5 py-0.5 text-foreground hover:bg-state-hover"
              onClick={() =>
                void copyToClipboard({ text: repairPrompt(t, broken) }).then(
                  (ok) => ok && notifyCockpit("success", "copied"),
                )
              }
            >
              {t("copyFix")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function LanguageSettings() {
  const t = useText();
  const { mode, save } = useLanguageMode();
  const chrome = useHostSettingsChrome();
  const [saving, setSaving] = useState(false);
  return (
    <label className="flex items-center justify-between gap-3 text-sm" data-cockpit-language ref={chrome}>
      <span>{t("language")}</span>
      <select
        value={mode}
        disabled={saving}
        className="rounded-md border border-border bg-popover px-2 py-1 text-popover-foreground"
        onChange={async (event) => {
          setSaving(true);
          try { await save(languageMode(event.currentTarget.value)); }
          catch { notifyCockpit("error", "languageFailed"); }
          finally { setSaving(false); }
        }}
      >
        <option value="auto">{t("auto")}</option>
        <option value="en">{t("english")}</option>
        <option value="zh">{t("chinese")}</option>
      </select>
    </label>
  );
}
