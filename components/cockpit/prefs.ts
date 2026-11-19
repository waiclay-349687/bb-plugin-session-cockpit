/**
 * [INPUT]: 依赖浏览器 localStorage 与 React useSyncExternalStore
 * [OUTPUT]: 对外提供 usePrefs / readPrefs / subscribePrefs / SECTION_DEFS / SectionId: 本机偏好 (隐藏哪些分区、当前展开的分区、宿主样式开关); 非 hook 的 read/subscribe 供内容脚本使用
 * [POS]: components/cockpit 的偏好层, 对应 Ghostex 的 Choose details 与 T3 Code 的 threadDetailsItems; 消费者: cockpit.tsx 与 settings-section.tsx; 与 data.ts 的边界: 偏好只存在本机浏览器, 不进服务端
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useCallback, useSyncExternalStore } from "react";

/** 分区清单是"选择显示哪些详情"的唯一真相源; 顺序即显示顺序 */
export const SECTION_DEFS = [
  { id: "progress", label: "Progress recap" },
  { id: "context", label: "Context window" },
  { id: "usage", label: "Usage and cache" },
  { id: "servers", label: "Servers" },
  { id: "scripts", label: "Project scripts" },
  { id: "contextFiles", label: "Context files" },
  { id: "connectors", label: "Connectors" },
  { id: "sideChats", label: "Side chats" },
] as const;

export type SectionId = (typeof SECTION_DEFS)[number]["id"];

interface Prefs {
  hidden: SectionId[];
  /** 展开着的分区, 可同时展开多个 */
  open: SectionId[];
  /** 对 bb 宿主界面的样式改动 (host-styles.ts), 各自可关 */
  hostStyles: { cardMotion: boolean; desktopCursor: boolean };
}

export type HostStyleBlock = keyof Prefs["hostStyles"];

/** 默认全部收起: 每一项只占一行, 细节点开才看 */
const DEFAULT_PREFS: Prefs = { hidden: [], open: [], hostStyles: { cardMotion: true, desktopCursor: true } };
const STORAGE_KEY = "bb-plugin-session-cockpit:prefs:v6";
/**
 * v6 起卡片按组排列、默认全部收起。读不到 v6 时沿用旧版本里"隐藏了哪些分区"和界面修饰开关,
 * 但丢掉旧的展开状态: 旧版默认展开 Progress 与 Usage, 带过来的话新排版一上来就是摊开的。
 */
const LEGACY_KEYS = ["bb-plugin-session-cockpit:prefs:v5", "bb-plugin-session-cockpit:prefs:v4"];
const SECTION_IDS = new Set<string>(SECTION_DEFS.map((s) => s.id));

const listeners = new Set<() => void>();
let cache: Prefs | null = null;

/** localStorage 是不可信输入: 逐字段校验, 坏数据回落默认值 */
export function readPrefs(): Prefs {
  if (cache) return cache;
  let parsed: Record<string, unknown> = {};
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current !== null) parsed = JSON.parse(current) as Record<string, unknown>;
    else {
      const legacy = LEGACY_KEYS.map((key) => localStorage.getItem(key)).find((value) => value !== null);
      parsed = { ...(JSON.parse(legacy ?? "{}") as Record<string, unknown>), open: [] };
    }
  } catch {
    parsed = {};
  }
  const hidden = Array.isArray(parsed.hidden)
    ? (parsed.hidden.filter((v) => typeof v === "string" && SECTION_IDS.has(v)) as SectionId[])
    : [];
  const open = Array.isArray(parsed.open)
    ? (parsed.open.filter((v) => typeof v === "string" && SECTION_IDS.has(v)) as SectionId[])
    : DEFAULT_PREFS.open;
  const host = (parsed.hostStyles ?? {}) as Record<string, unknown>;
  cache = {
    hidden,
    open,
    // 只有显式存了 false 才算关闭, 缺字段 (旧数据) 按默认开启
    hostStyles: { cardMotion: host.cardMotion !== false, desktopCursor: host.desktopCursor !== false },
  };
  return cache;
}

function write(next: Prefs) {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式等写不进去时只保留内存态
  }
  for (const listener of listeners) listener();
}

export function subscribePrefs(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
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
  const reset = useCallback(() => write(DEFAULT_PREFS), []);
  return {
    prefs,
    isHidden: (id: SectionId) => prefs.hidden.includes(id),
    toggleHidden,
    toggleOpen,
    toggleHostStyle,
    reset,
  };
}
