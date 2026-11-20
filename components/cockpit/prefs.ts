/**
 * [INPUT]: 依赖浏览器 localStorage 与 React useSyncExternalStore
 * [OUTPUT]: 对外提供 usePrefs / readPrefs / subscribePrefs / SECTION_DEFS（含翻译键） / SectionId: 本机偏好 (板块顺序、语言、显隐、展开、显示参数和宿主样式开关); 非 hook 的 read/subscribe 供内容脚本使用
 * [POS]: components/cockpit 的偏好层, 对应 Ghostex 的 Choose details 与 T3 Code 的 threadDetailsItems; 消费者: cockpit.tsx 与 settings-section.tsx; 与 data.ts 的边界: 偏好只存在本机浏览器, 不进服务端
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useCallback, useSyncExternalStore } from "react";

import { DEFAULT_PREFS, DEFAULT_DISPLAY, PREFS_KEY, displayValue, loadPrefs, moveSection, type DisplayKey, type Prefs, type SectionId } from "../../lib/cockpit-prefs";
import type { Language } from "../../lib/i18n";

export { SECTION_DEFS, type SectionId } from "../../lib/cockpit-prefs";
export type HostStyleBlock = keyof Prefs["hostStyles"];

const listeners = new Set<() => void>();
let cache: Prefs | null = null;

/** localStorage 是不可信输入: 逐字段校验, 坏数据回落默认值 */
export function readPrefs(): Prefs {
  return cache ??= loadPrefs(key => localStorage.getItem(key));
}

function write(next: Prefs) {
  cache = next;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式等写不进去时只保留内存态
  }
  for (const listener of listeners) listener();
}

export function subscribePrefs(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PREFS_KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePrefs() {
  const prefs = useSyncExternalStore(subscribePrefs, readPrefs, () => DEFAULT_PREFS);
  const toggleHidden = useCallback((id: SectionId) => {
    const current = readPrefs();
    write({ ...current, hidden: current.hidden.includes(id) ? current.hidden.filter((x) => x !== id) : [...current.hidden, id] });
  }, []);
  /** 各分区独立展开/收起 */
  const toggleOpen = useCallback((id: SectionId) => {
    const current = readPrefs();
    write({ ...current, open: current.open.includes(id) ? current.open.filter((x) => x !== id) : [...current.open, id] });
  }, []);
  const toggleHostStyle = useCallback((block: HostStyleBlock) => {
    const current = readPrefs();
    write({ ...current, hostStyles: { ...current.hostStyles, [block]: !current.hostStyles[block] } });
  }, []);
  const move = useCallback((id: SectionId, target: number) => {
    const current = readPrefs();
    write({ ...current, order: moveSection(current.order, id, target) });
  }, []);
  const setSectionLanguage = useCallback((id: SectionId, language?: Language) => {
    const current = readPrefs();
    const sectionLanguages = { ...current.sectionLanguages };
    if (language) sectionLanguages[id] = language;
    else delete sectionLanguages[id];
    write({ ...current, sectionLanguages });
  }, []);
  const setDisplay = useCallback((key: DisplayKey, value: number) => {
    const current = readPrefs();
    write({ ...current, display: { ...current.display, [key]: displayValue(key, value) } });
  }, []);
  const resetDisplay = useCallback(() => write({ ...readPrefs(), display: DEFAULT_DISPLAY }), []);
  const reset = useCallback(() => write({
    ...readPrefs(), order: DEFAULT_PREFS.order, sectionLanguages: {}, hidden: [], open: [],
  }), []);
  return {
    prefs,
    isHidden: (id: SectionId) => prefs.hidden.includes(id),
    toggleHidden,
    toggleOpen,
    toggleHostStyle,
    move, setSectionLanguage, setDisplay, resetDisplay,
    reset,
  };
}
