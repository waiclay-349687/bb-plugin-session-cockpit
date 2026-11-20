/**
 * [INPUT]: Worktree Lineage 的配置读取和更新 RPC、Cockpit 的板块语言及双语词典。
 * [OUTPUT]: BriefingSettings 展示和保存速览配置、系统提示词与计数操作。
 * [POS]: 跨插件设置入口；生成配置由 Worktree Lineage 持久化并执行。
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useState } from "react";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_useRpcMutation, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { BRIEFING_FALLBACK_MAX, BRIEFING_GATEWAY_MAX, BRIEFING_LIMIT, BRIEFING_PROMPT_MAX, briefingConfigSchema, briefingPatch, briefingUpdateSchema, type BriefingConfig, type BriefingEdit, type BriefingUpdate } from "../../lib/briefing-config";
import { effectiveSectionLanguage } from "../../lib/cockpit-prefs";
import { languageMode, type MessageKey } from "../../lib/i18n";
import { useLanguage, useText } from "./language";
import { usePrefs } from "./prefs";

const pluginId = "worktree-lineage";
const contract = defineRpcContract({
  briefingConfig: { input: z.object({}).strict(), output: briefingConfigSchema },
  setBriefingConfig: { input: briefingUpdateSchema, output: briefingConfigSchema },
});

const FIELD = "w-full min-w-0 rounded-md border border-border bg-popover px-2 py-1.5 text-sm text-popover-foreground";
const BUTTON = "rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-state-hover disabled:opacity-50";

export function BriefingSettings() {
  const t = useText();
  const query = experimental_useRpcQuery({ pluginId, contract, method: "briefingConfig", input: {} });
  const mutation = experimental_useRpcMutation({ pluginId, contract, method: "setBriefingConfig" });
  return (
    <section className="space-y-3" data-cockpit-briefing>
      <h3 className="text-sm font-medium">{t("briefingSettings")}</h3>
      {query.data ? (
        <BriefingForm config={query.data} save={async input => {
          const result = await mutation.mutate(input);
          void query.refetch();
          return result;
        }} />
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t(query.error ? "briefingUnavailable" : "briefingLoading")}</p>
          {query.error ? <button className={BUTTON} type="button" onClick={() => void query.refetch()}>{t("retry")}</button> : null}
        </div>
      )}
    </section>
  );
}

function BriefingForm({ config, save }: { config: BriefingConfig; save: (input: BriefingUpdate) => Promise<BriefingConfig> }) {
  const t = useText();
  const language = useLanguage();
  const { prefs } = usePrefs();
  const [edits, setEdits] = useState<Partial<BriefingEdit>>({});
  const [receipt, setReceipt] = useState<{ read: BriefingConfig; saved: BriefingConfig }>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<MessageKey>();
  const base = receipt?.read === config ? receipt.saved : config;
  const draft = { ...base, ...edits };
  const patch = briefingPatch(base, edits);
  const valid = briefingUpdateSchema.safeParse(patch).success;
  const sectionLang = effectiveSectionLanguage(language, prefs.sectionLanguages, "progress");
  const resolvedLang = draft.language === "auto" ? base.resolvedLanguage : draft.language;
  const defaultPrompt = resolvedLang === "zh" ? base.defaultSystemPromptZh : base.defaultSystemPromptEn;
  const update = <Key extends keyof BriefingEdit>(key: Key, value: BriefingEdit[Key]) => {
    setEdits(current => ({ ...current, [key]: value }));
    setStatus(undefined);
  };
  const submit = async (command: BriefingUpdate, clearEdits = false) => {
    setBusy(true);
    setStatus(undefined);
    try {
      const saved = await save(command);
      setReceipt({ read: config, saved });
      if (clearEdits) setEdits({});
      setStatus("briefingSaved");
    } catch {
      setStatus("briefingSaveFailed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="space-y-3" onSubmit={event => {
      event.preventDefault();
      if (valid && Object.keys(patch).length > 0) void submit(patch, true);
    }}>
      <p className="text-sm text-muted-foreground">{t("briefingShared")}</p>
      <fieldset disabled={busy} className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.enabled} onChange={event => update("enabled", event.target.checked)} />
          {t("briefingEnabled")}
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">{t("briefingLanguage")}
            <select className={FIELD} value={draft.language} onChange={event => update("language", languageMode(event.target.value))}>
              <option value="auto">{t("auto")}</option>
              <option value="en">{t("english")}</option>
              <option value="zh">{t("chinese")}</option>
            </select>
          </label>
          <div className="space-y-1 self-end text-xs text-muted-foreground">
            <p>{t("briefingResolved", { language: t(resolvedLang === "zh" ? "chinese" : "english") })}</p>
            {resolvedLang !== sectionLang ? (
              <button type="button" className={BUTTON} onClick={() => update("language", sectionLang)}>
                {t("briefingUseSectionLanguage")}
              </button>
            ) : null}
          </div>
          <label className="space-y-1 text-sm">{t("briefingGateway")}
            <input className={FIELD} name="gatewayUrl" maxLength={BRIEFING_GATEWAY_MAX} value={draft.gatewayUrl} placeholder="http://127.0.0.1:3425" onChange={event => update("gatewayUrl", event.target.value)} />
          </label>
          <label className="space-y-1 text-sm">{t("briefingFallback")}
            <input className={FIELD} name="fallbackModel" maxLength={BRIEFING_FALLBACK_MAX} required value={draft.fallbackModel} placeholder="haiku" onChange={event => update("fallbackModel", event.target.value)} />
          </label>
        </div>
        <label className="block space-y-1 text-sm">{t("briefingModels")}
          <input className={FIELD} name="gatewayModel" maxLength={BRIEFING_GATEWAY_MAX} value={draft.gatewayModel} onChange={event => update("gatewayModel", event.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">{t("briefingSystemPrompt")}
          <textarea className={FIELD} name="systemPrompt" rows={5} maxLength={BRIEFING_PROMPT_MAX} value={draft.systemPrompt} placeholder={t("briefingEmptyPrompt")} onChange={event => update("systemPrompt", event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BUTTON} onClick={() => update("systemPrompt", defaultPrompt)}>{t("briefingFillPrompt")}</button>
          <button type="button" className={BUTTON} onClick={() => update("systemPrompt", "")}>{t("briefingResetPrompt")}</button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">{t("briefingDailyLimit")}
            <input name="dailyLimit" className={`${FIELD} max-w-32`} type="number" min={BRIEFING_LIMIT.min} max={BRIEFING_LIMIT.max} step={1} required value={Number.isFinite(draft.dailyLimit) ? draft.dailyLimit : ""}
              onChange={event => update("dailyLimit", event.target.valueAsNumber)} />
          </label>
          <span className="text-sm text-muted-foreground">{t("briefingToday", { count: base.todayCount })}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={BUTTON} disabled={!valid || !Object.keys(patch).length}>{t("save")}</button>
          <button type="button" className={BUTTON} onClick={() => void submit({ resetTodayCount: true })}>{t("briefingResetToday")}</button>
          <button type="button" className={BUTTON} onClick={() => void submit({ clearCooldowns: true })}>{t("briefingClearCooldowns")}</button>
        </div>
      </fieldset>
      {status ? <p role="status" className="text-xs text-muted-foreground">{t(status)}</p> : null}
    </form>
  );
}
