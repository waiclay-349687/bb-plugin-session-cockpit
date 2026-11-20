/**
 * [INPUT]: 依赖 prefs.ts 的 SECTION_DEFS 与 usePrefs、host-styles.ts 的自检结果、脚手架 Checkbox
 * [OUTPUT]: 提供语言、板块编排、显示参数、宿主样式和自检设置
 * [POS]: components/cockpit 的设置视图; 消费者: app.tsx 的 settingsSection; 与各分区的边界: 卡片高度有限, 开关不放进卡片本身
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useText, useLanguage, useLanguageMode, notifyCockpit } from "./language";
import { useEffect, useState } from "react";
import { experimental_copyToClipboard as copyToClipboard } from "@get-bb/plugin-sdk/app";
import { DISPLAY_LIMITS, type DisplayKey } from "../../lib/cockpit-prefs";
import { languageMode } from "../../lib/i18n";
import { Checkbox } from "@/components/ui/checkbox";
import { repairPrompt, recheckHostHealth, useHostHealth, useHostSettingsChrome, type HookResult } from "./host-styles";
import { SECTION_DEFS, usePrefs, type HostStyleBlock, type SectionId } from "./prefs";

const CONTROL = "rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground";
const ARROW = "h-7 w-7 rounded-md border border-border text-sm hover:bg-state-hover disabled:opacity-40";

export function ChooseDetailsSettings() {
  const t = useText();
  const { prefs, isHidden, toggleHidden, move, setSectionLanguage, reset } = usePrefs();
  const [dragged, setDragged] = useState<SectionId | null>(null);
  const [over, setOver] = useState<SectionId | null>(null);
  return (
    <section className="space-y-3" data-cockpit-settings>
      <h3 className="text-sm font-medium">{t("chooseDetails")}</h3>
      <p className="text-sm text-muted-foreground">{t("sectionsHelp")}</p>
      <ol className="space-y-1.5" aria-label={t("chooseDetails")}>
        {prefs.order.map((id, index) => {
          const section = SECTION_DEFS.find(entry => entry.id === id)!;
          const label = t(section.label);
          return (
            <li key={id} data-section-setting={id}
              className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 ${over === id ? "border-primary bg-state-hover" : "border-border"}`}
              onDragOver={event => {
                if (!dragged) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setOver(id);
              }}
              onDrop={event => {
                event.preventDefault();
                if (dragged) move(dragged, index);
                setDragged(null);
                setOver(null);
              }}
            >
              <span className="cursor-grab select-none text-muted-foreground active:cursor-grabbing"
                draggable aria-hidden title={t("dragSection", { name: label })}
                onDragStart={event => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", id);
                  setDragged(id);
                }}
                onDragEnd={() => { setDragged(null); setOver(null); }}>
                ⠿
              </span>
              <label className="flex min-w-36 flex-1 items-center gap-2 text-sm">
                <Checkbox checked={!isHidden(id)} onCheckedChange={() => toggleHidden(id)} />
                {label}
              </label>
              <select className={CONTROL} aria-label={t("sectionLanguage", { name: label })}
                value={prefs.sectionLanguages[id] ?? "auto"} onChange={event => {
                  const mode = languageMode(event.target.value);
                  setSectionLanguage(id, mode === "auto" ? undefined : mode);
                }}>
                <option value="auto">{t("followPlugin")}</option>
                <option value="en">{t("english")}</option>
                <option value="zh">{t("chinese")}</option>
              </select>
              <button type="button" className={ARROW} aria-label={t("moveUp", { name: label })} disabled={index === 0} onClick={() => move(id, index - 1)}>↑</button>
              <button type="button" className={ARROW} aria-label={t("moveDown", { name: label })} disabled={index === prefs.order.length - 1} onClick={() => move(id, index + 1)}>↓</button>
            </li>
          );
        })}
      </ol>
      <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={reset}>{t("reset")}</button>
    </section>
  );
}

export function DisplaySettings() {
  const t = useText();
  const { prefs, setDisplay, resetDisplay } = usePrefs();
  return (
    <section className="space-y-3" data-cockpit-display>
      <h3 className="text-sm font-medium">{t("displaySettings")}</h3>
      {(Object.keys(DISPLAY_LIMITS) as DisplayKey[]).map(key => {
        const bounds = DISPLAY_LIMITS[key];
        const value = prefs.display[key];
        return (
          <label key={key} className="grid items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(9rem,1fr)_minmax(6rem,12rem)_5rem]">
            <span>{t(key)}</span>
            <input type="range" name={key} min={bounds.min} max={bounds.max} value={value} onChange={event => setDisplay(key, event.target.valueAsNumber)} />
            <output className="text-xs tabular-nums text-muted-foreground">
              {key === "cardHeight" ? t("pixels", { value }) : key === "warningPercent" ? `${value}%` : value}
            </output>
          </label>
        );
      })}
      <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={resetDisplay}>{t("reset")}</button>
    </section>
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
