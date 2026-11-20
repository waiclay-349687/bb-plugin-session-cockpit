/**
 * [INPUT]: 后端 language RPC、浏览器初始镜像和宿主语言。
 * [OUTPUT]: 提供全局与板块独立语言、挂载时的语言、实时翻译、语言保存与跨标签页同步。
 * [POS]: 将服务端配置与 React 和内容脚本共用的语言存储连接起来。
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { toast } from "sonner";
import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { experimental_useRpcQuery, useRpc } from "@get-bb/plugin-sdk/app";
import { languageMode, resolveLanguage, textFor, type Language, type LanguageMode, type MessageKey } from "../../lib/i18n";
import { formatTokens, formatCost, formatDuration, formatTtl, formatCountdown, formatAgo } from "../../lib/format";
import { rpcContract } from "../../rpc";

const KEY = "bb-plugin-session-cockpit:language";
function storedMode(): LanguageMode {
  try { return languageMode(globalThis.localStorage?.getItem(KEY)); }
  catch { return "auto"; }
}
let mode = storedMode();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
let lastLanguage = currentBrowserLanguage();
function notify() {
  const language = currentBrowserLanguage();
  if (language !== lastLanguage) {
    toast.dismiss("session-cockpit:notice");
    toast.dismiss("session-cockpit:host-warning");
    lastLanguage = language;
  }
  for (const listener of listeners) listener();
}
function currentBrowserLanguage() {
  return resolveLanguage(mode, globalThis.document?.documentElement.lang, globalThis.navigator?.language);
}
export const currentLanguage = currentBrowserLanguage;
export const currentText = () => textFor[currentLanguage()];

export function notifyCockpit(kind: "success" | "error", key: MessageKey, args?: Record<string, string | number>) {
  toast[kind](currentText()(key, args), { id: "session-cockpit:notice" });
}

/** 板块内的通知与面板一同使用有效语言，包括异步动作完成后的提示。 */
export function useSectionNotice() {
  const t = useText();
  return (kind: "success" | "error", key: MessageKey, args?: Record<string, string | number>) =>
    toast[kind](t(key, args), { id: "session-cockpit:notice" });
}

function setMode(next: LanguageMode) {
  if (mode === next) return;
  mode = next;
  try { globalThis.localStorage?.setItem(KEY, next); }
  catch { /* 私密浏览仍可在当前页面切换。 */ }
  notify();
}

export function LanguageSync() {
  const { data } = experimental_useRpcQuery({ contract: rpcContract, method: "language", input: {} });
  useEffect(() => {
    if (data) setMode(data.language);
  }, [data?.language]);
  useEffect(() => {
    const fromStorage = (event: StorageEvent) => {
      if (event.key === KEY) setMode(storedMode());
    };
    const observer = new MutationObserver(notify);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    window.addEventListener("languagechange", notify);
    window.addEventListener("storage", fromStorage);
    return () => {
      observer.disconnect();
      window.removeEventListener("languagechange", notify);
      window.removeEventListener("storage", fromStorage);
    };
  }, []);
  return null;
}

export function useLanguageMode() {
  const value = useSyncExternalStore(subscribe, () => mode, () => "auto" as const);
  const rpc = useRpc<typeof rpcContract>();
  const save = async (next: LanguageMode) => {
    const previous = mode;
    setMode(next);
    try { await rpc.call("setLanguage", { language: next }); }
    catch (error) {
      if (mode === next) setMode(previous);
      throw error;
    }
  };
  return { mode: value, save };
}
const SectionLanguage = createContext<Language | undefined>(undefined);

export function SectionLanguageProvider({ lang, children }: { lang: Language; children: ReactNode }) {
  return <SectionLanguage.Provider value={lang}>{children}</SectionLanguage.Provider>;
}

export function useLanguage(): Language {
  const section = useContext(SectionLanguage);
  const global = useSyncExternalStore(subscribe, currentLanguage, () => "en" as const);
  return section ?? global;
}

export const useText = () => textFor[useLanguage()];

const scopedFormats = (language: "en" | "zh") => ({
  language,
  t: textFor[language],
  formatTokens: (value: Parameters<typeof formatTokens>[0]) => formatTokens(value, language),
  formatCost: (value: Parameters<typeof formatCost>[0]) => formatCost(value, language),
  formatDuration: (ms: number | null) => formatDuration(ms, language),
  formatTtl: (ms: number | null) => formatTtl(ms, language),
  formatCountdown: (ms: number | null, now: number) => formatCountdown(ms, now, language),
  formatAgo: (ms: number | null, now: number) => formatAgo(ms, now, language),
});
const formats = { en: scopedFormats("en"), zh: scopedFormats("zh") };
export const useTranslation = () => formats[useLanguage()];
