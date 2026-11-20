/**
 * [INPUT]: 依赖本地保存的偏好和当前插件语言。
 * [OUTPUT]: 提供板块清单、偏好校验、前序版本迁移及排序函数。
 * [POS]: 无浏览器依赖的偏好模型；由 prefs.ts 负责存储和通知。
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import type { Language } from "./i18n";

/** 分区清单是"选择显示哪些详情"的唯一真相源; 顺序即显示顺序 */
export const SECTION_DEFS = [
  { id: "environment", label: "environment" },
  { id: "progress", label: "progressRecap" },
  { id: "context", label: "context" },
  { id: "usage", label: "usageAndCache" },
  { id: "servers", label: "servers" },
  { id: "scripts", label: "scripts" },
  { id: "contextFiles", label: "contextFiles" },
  { id: "connectors", label: "connectors" },
  { id: "sideChats", label: "sideChats" },
] as const;

export type SectionId = (typeof SECTION_DEFS)[number]["id"];

export const DISPLAY_LIMITS = {
  warningPercent: { min: 50, max: 95, initial: 80 },
  inlineLimit: { min: 4, max: 20, initial: 8 },
  cardHeight: { min: 480, max: 1200, initial: 864 },
} as const;

export type DisplayKey = keyof typeof DISPLAY_LIMITS;
export type DisplayPrefs = Record<DisplayKey, number>;
export type SectionLanguages = Partial<Record<SectionId, Language>>;
export interface Prefs {
  hidden: SectionId[];
  open: SectionId[];
  order: SectionId[];
  sectionLanguages: SectionLanguages;
  display: DisplayPrefs;
  hostStyles: { cardMotion: boolean; desktopCursor: boolean };
}

export const DEFAULT_ORDER = SECTION_DEFS.map(s => s.id);
export const DEFAULT_DISPLAY: DisplayPrefs = {
  warningPercent: DISPLAY_LIMITS.warningPercent.initial,
  inlineLimit: DISPLAY_LIMITS.inlineLimit.initial,
  cardHeight: DISPLAY_LIMITS.cardHeight.initial,
};
export const DEFAULT_PREFS: Prefs = {
  hidden: [], open: [], order: DEFAULT_ORDER, sectionLanguages: {}, display: DEFAULT_DISPLAY,
  hostStyles: { cardMotion: true, desktopCursor: true },
};

export const PREFS_KEY = "bb-plugin-session-cockpit:prefs:v7";
export const LEGACY_PREFS = ["bb-plugin-session-cockpit:prefs:v6", "bb-plugin-session-cockpit:prefs:v5", "bb-plugin-session-cockpit:prefs:v4"] as const;

const ids = new Set<unknown>(DEFAULT_ORDER);
const sections = (value: unknown): SectionId[] =>
  Array.isArray(value) ? [...new Set(value.filter((id): id is SectionId => ids.has(id)))] : [];
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};

export function displayValue(key: DisplayKey, value: unknown): number {
  const { min, max, initial } = DISPLAY_LIMITS[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : initial;
}

export function decodePrefs(value: unknown, keepOpen = true): Prefs {
  const raw = object(value);
  const order = sections(raw.order);
  const language = object(raw.sectionLanguages);
  const sectionLanguages: SectionLanguages = {};
  for (const id of DEFAULT_ORDER) {
    const mode = language[id];
    if (mode === "en" || mode === "zh") sectionLanguages[id] = mode;
  }
  const display = object(raw.display);
  const host = object(raw.hostStyles);
  return {
    order: [...order, ...DEFAULT_ORDER.filter(id => !order.includes(id))],
    hidden: sections(raw.hidden),
    open: keepOpen ? sections(raw.open) : [],
    sectionLanguages,
    display: {
      warningPercent: displayValue("warningPercent", display.warningPercent),
      inlineLimit: displayValue("inlineLimit", display.inlineLimit),
      cardHeight: displayValue("cardHeight", display.cardHeight),
    },
    hostStyles: { cardMotion: host.cardMotion !== false, desktopCursor: host.desktopCursor !== false },
  };
}

export function loadPrefs(read: (key: string) => string | null): Prefs {
  for (const key of [PREFS_KEY, ...LEGACY_PREFS]) {
    try {
      const stored = read(key);
      if (stored !== null) return decodePrefs(JSON.parse(stored), key === PREFS_KEY || key === LEGACY_PREFS[0]);
    } catch { /* 损坏的版本可以回落到较早的有效版本。 */ }
  }
  return DEFAULT_PREFS;
}

export function moveSection(order: readonly SectionId[], id: SectionId, targetIndex: number): SectionId[] {
  const from = order.indexOf(id);
  if (from < 0 || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= order.length || targetIndex === from) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(targetIndex, 0, id);
  return next;
}

export function effectiveSectionLanguage(global: Language, overrides: SectionLanguages, id: SectionId): Language {
  return overrides[id] ?? global;
}
