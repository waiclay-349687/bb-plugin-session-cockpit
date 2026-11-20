/**
 * [INPUT]: 依赖 bb 应用外壳的 DOM 结构 (见 HOOKS 清单)、prefs.ts 的开关和卡片高度、sonner 的 toast
 * [OUTPUT]: 对外提供 mountHostStyles (内容脚本入口)、useHostHealth / recheckHostHealth、repairPrompt 与实时宿主分区标题同步
 * [POS]: 插件对 bb 宿主界面的全部"越界"改动都集中在这里, 与主题无关、任何主题下都生效:
 *        (0) 隐藏卡片槽位的 Session 标题, 让卡片里的分组成为顶层分组 (1) 线程上下文卡片的出入场 (在会话之间切换时不重播入场: 卡片留在原地只换内容)、对话区平滑让位、历史导航条不被挤掉、应用浏览器偏好中的卡片限高 (2) 桌面习惯的箭头光标 (链接留手形、消息正文保留文字光标)。
 *        这些规则依赖 bb 未承诺稳定的结构, 所以同文件里带自检: 结构变了就提醒, 并给出修复办法。
 *        消费者: app.tsx (contentScripts.register)、settings-section.tsx
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { experimental_copyToClipboard as copyToClipboard } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { currentText, useText, notifyCockpit } from "./language";
import { PLUGIN_DESCRIPTION, type MessageKey, type Text } from "../../lib/i18n";
import { readPrefs, subscribePrefs } from "./prefs";

function slotTitle(section: Element) {
  const heading = section.querySelector("[data-thread-context-card-heading], :scope > div > h3");
  return heading?.querySelector(".truncate") ?? heading;
}

/** SDK 注册只收固定标题。把已挂载的标题同步到当前语言，仅操作插件所在的宿主分区。 */
export function useHostHeading<Element extends HTMLElement = HTMLSpanElement>(key: MessageKey, kind: "card" | "banner" = "card") {
  const t = useText();
  const ref = useRef<Element>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (kind === "banner") {
      const group = node?.closest('[role="group"][aria-label]');
      if (group) group.setAttribute("aria-label", t(key));
      return;
    }
    const section = node?.closest("[data-thread-context-card-section]");
    const title = section && slotTitle(section);
    if (title && title.textContent !== t(key)) title.textContent = t(key);
    if (section?.hasAttribute("aria-label")) section.setAttribute("aria-label", t(key));
  });
  return ref;
}

/** 当前设置页由插件绘制语言选择器；隐藏宿主根据同一配置自动生成的重复行。 */
export function useHostSettingsChrome() {
  const ref = useRef<HTMLLabelElement>(null);
  const t = useText();
  useLayoutEffect(() => {
    const section = ref.current?.closest("[data-resource-detail-section]");
    if (!section) return;
    const native = section.querySelector<HTMLElement>('[data-settings-anchor="Language"]');
    const heading = section.querySelector("h2, h3");
    const previousDisplay = native?.style.display;
    const previousHeading = heading?.textContent;
    if (native) native.style.display = "none";
    if (heading?.textContent === "Configuration") heading.textContent = t("configuration");
    const detail = section.closest('div[class~="max-w-5xl"]');
    const description = detail && Array.from(detail.querySelectorAll("p, span.break-words")).find(node => node.textContent === PLUGIN_DESCRIPTION);
    if (description) description.textContent = t("pluginDescription");
    return () => {
      if (native) native.style.display = previousDisplay ?? "";
      if (heading && previousHeading != null) heading.textContent = previousHeading;
      if (description) description.textContent = PLUGIN_DESCRIPTION;
    };
  }, [t]);
  return ref;
}

const EASE = "var(--glass-ease, cubic-bezier(0.165, 0.84, 0.44, 1))";

const HEIGHT_VAR = "--session-cockpit-max-height";
const CARD_HEIGHT_CSS = `
[data-scroll-overlay] > [data-thread-context-card]:has([data-cockpit-layout]) { max-height: min(var(${HEIGHT_VAR}), calc(100% - 1.5rem)); }
[data-thread-context-card-section]:has([data-cockpit-layout]):not(:has([data-cockpit-item])) { display: none; }
/* 宿主槽位的 "Session" 标题只是 SDK 必填的注册名: 卡片里 Environment / Progress / Usage / Workspace 各有自己的分组标题, 是平级顶层分组, 不再套在 Session 底下 */
[data-thread-context-card-section]:has([data-cockpit-layout]) > div:has(> h3) { display: none; }`;
/** 切换会话的瞬间挂在 <html> 上的标记: 这段时间里出现的卡片不做入场动画 */
const WARM_ATTR = "data-session-cockpit-card-warm";
const WARM_MS = 700;
const SETTLE_MS = 320;
/** 切换前那张卡片的高度, 新卡片在标记期间至少这么高 */
const HOLD_VAR = "--session-cockpit-card-hold";

/**
 * 卡片动效。依赖的结构:
 * - [data-scroll-overlay]: 对话区上的浮层列, 卡片与历史提问导航条 (.my-auto) 都是它的直接子元素
 * - [data-thread-context-card]: 卡片; 收起时 bb 给它加 hidden
 * - div:has(> [data-scroll-footer]): 对话滚动内容, bb 用内联 padding-inline-end (0 ↔ 312px) 给卡片让位
 */
const CARD_MOTION_CSS = `
[data-scroll-overlay] { position: relative; }
/* 卡片脱离浮层列的排版流, 否则它一出现就把历史导航条往下挤 */
[data-scroll-overlay] > [data-thread-context-card] { position: absolute; top: 0.75rem; right: 0.75rem; }
/* 卡片在时, 导航条平移到卡片左侧 (让位后的对话区右缘), 始终垂直居中 */
[data-scroll-overlay]:has(> [data-thread-context-card]:not([hidden])) > .my-auto { translate: calc(-18rem - 0.75rem) 0; }
@media (prefers-reduced-motion: no-preference) {
  div:has(> [data-scroll-footer]) { transition: padding-inline-end 0.26s ${EASE}; }
  [data-scroll-overlay] > .my-auto { transition: translate 0.26s ${EASE}; }
  [data-scroll-overlay] > [data-thread-context-card] {
    min-height: 0;
    transition: opacity 0.2s ease-out, translate 0.26s ${EASE}, min-height 0.26s ${EASE}, display 0.26s allow-discrete;
  }
  [data-scroll-overlay] > [data-thread-context-card][hidden] { opacity: 0; translate: 12px 0; }
  @starting-style {
    [data-scroll-overlay] > [data-thread-context-card]:not([hidden]) { opacity: 0; translate: 12px 0; }
  }
  /*
   * 切换会话: bb 重建线程视图, 卡片是个新节点。切换前卡片就开着的话 (见 mountHostStyles):
   * 新卡片直接出现在原位, 不重播滑入; 并先撑到上一张卡片的高度, 免得新会话的数据还没到时缩成一小条。
   * 之后进入 settle 阶段: 过渡恢复, min-height 从旧高度过渡到新内容的实际高度, 卡片平滑收到位。
   */
  :root[${WARM_ATTR}] [data-scroll-overlay] > [data-thread-context-card] { min-height: var(${HOLD_VAR}, 0px); }
  :root[${WARM_ATTR}="hold"] [data-scroll-overlay] > [data-thread-context-card] { transition: none; }
}`;

/**
 * 桌面光标。bb 用 cursor-pointer 工具类给控件加手形 (网页习惯); 这里还原成箭头 (macOS 原生习惯),
 * 只给正文里的超链接、外链和带下划线的文字链接 (如卡片里的记忆文件) 留手形。不碰 grab / resize / text / not-allowed。
 * :where() 把特异性压到最低, 后面的链接规则才能盖过它。
 *
 * cursor 会继承, 所以规则只能落在控件本身, 绝不能落在包着正文的容器上 (否则正文选字时看不到文字光标):
 * - 只匹配完整类名 cursor-pointer ([class~=]), 不用子串匹配 ([class*=] 会误中 bb 对话容器上的
 *   `[&_button:not(:disabled)]:cursor-pointer`, 那是"给容器里的按钮加手形", 容器本身包着全部消息正文);
 * - 这类"给子按钮加手形"的容器, 单独把它里面的按钮还原成箭头 (特异性要高过 Tailwind 生成的 .x button:not(:disabled))。
 */
const CURSOR_CSS = `
[class~="cursor-pointer"]:where(:not(:disabled, [aria-disabled="true"])), a[href] { cursor: default; }
[class*="]:cursor-pointer"] :is(button, [role="button"]):not(:disabled) { cursor: default; }
/* 其他插件用自己的 CSS 加的手形 (没有任何 cursor- 工具类的按钮) 也一并还原 */
button:not([class*="cursor-"]):where(:not(:disabled)), [role="button"]:not([class*="cursor-"]), [role="tab"]:not([class*="cursor-"]) { cursor: default; }
[data-timeline-row-id] a[href], .prose a[href], a[href][target="_blank"], a[href][class~="underline"] { cursor: pointer; }`;

// ---------------------------------------------------------------------------
// 自检: 每条对应上面依赖的一处结构。前提不满足 (比如当前不在线程页) 记为 skipped, 不算失败; 设置里关掉的记为 off。
// ---------------------------------------------------------------------------

export type HookStatus = "ok" | "broken" | "skipped" | "off";

export interface HookResult {
  id: string;
  /** 这条钩子管的效果 */
  label: MessageKey;
  status: HookStatus;
  /** 失效时的表现与原因 */
  detail: MessageKey | null;
}

interface Hook {
  id: string;
  label: MessageKey;
  block?: "cardMotion" | "desktopCursor";
  /** 返回 null = 前提不满足; true = 正常; 字符串 = 失效原因 */
  check(): null | true | MessageKey;
}

const inThreadView = () => document.querySelector("form[data-promptbox]") !== null && document.querySelector("[data-timeline-row-id]") !== null;
const inPopover = (el: Element) => el.closest("[data-radix-popper-content-wrapper], [role=dialog]") !== null;

const HOOKS: Hook[] = [
  {
    id: "localized-headings",
    label: "checkLocalizedHeadings",
    check() {
      const markers = Array.from(document.querySelectorAll("[data-cockpit-group-heading]"));
      const settings = document.querySelector("[data-cockpit-language]")?.closest("[data-resource-detail-section]");
      if (markers.length === 0 && !settings) return null;
      for (const marker of markers) {
        const section = marker.closest("[data-thread-context-card-section]");
        if (!section || !slotTitle(section)) return "failedLocalizedHeadings";
      }
      const native = settings?.querySelector('[data-settings-anchor="Language"]');
      return !native || getComputedStyle(native).display === "none" ? true : "failedLocalizedHeadings";
    },
  },
  {
    // 与 CARD_HEIGHT_CSS 里隐藏宿主分区标题的规则对应: 结构变了 Session 标题会重新压在 Environment 等分组上方
    id: "group-headings",
    label: "checkGroupHeadings",
    check() {
      const sections = Array.from(document.querySelectorAll("[data-thread-context-card-section]:has([data-cockpit-layout])"));
      if (sections.length === 0) return null;
      return sections.every((section) => {
        const heading = section.querySelector(":scope > div:has(> h3)");
        return heading !== null && getComputedStyle(heading).display === "none";
      })
        ? true
        : "failedGroupHeadings";
    },
  },
  {
    id: "overlay",
    label: "checkOverlay",
    block: "cardMotion",
    check() {
      if (!inThreadView()) return null;
      return document.querySelector("[data-scroll-overlay]") ? true : "failedOverlay";
    },
  },
  {
    id: "card",
    label: "checkCard",
    block: "cardMotion",
    check() {
      // 用无障碍标签找卡片, 再看它是否还带着样式规则依赖的标记和位置
      const cards = Array.from(document.querySelectorAll('[role="group"][aria-label="Thread context"]')).filter((el) => !inPopover(el));
      if (cards.length === 0) return null;
      return cards.every((el) => el.matches("[data-scroll-overlay] > [data-thread-context-card]"))
        ? true
        : "failedCard";
    },
  },
  {
    id: "height",
    label: "checkHeight",
    check() {
      const card = document.querySelector<HTMLElement>("[data-scroll-overlay] > [data-thread-context-card]:not([hidden])");
      if (!card) return null;
      // 窗口足够高时，检查设定值是否实际覆盖 bb 的默认上限。
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const room = (card.parentElement?.clientHeight ?? 0) - 1.5 * rem;
      const target = readPrefs().display.cardHeight;
      if (room <= Math.min(36 * rem, target)) return null;
      // 算出来的 max-height 是一个 min(864px, 100% - 24px) 这样的表达式，不是数字：按里面有没有我们设的那个上限来判断
      const maxHeight = getComputedStyle(card).maxHeight;
      const applied = maxHeight.includes(`${target}px`) || Math.abs(parseFloat(maxHeight) - Math.min(target, room)) < 2;
      return applied ? true : "failedHeight";
    },
  },
  {
    id: "shift",
    label: "checkShift",
    block: "cardMotion",
    check() {
      const card = document.querySelector<HTMLElement>("[data-scroll-overlay] > [data-thread-context-card]:not([hidden])");
      if (!card) return null;
      const scroller = document.querySelector<HTMLElement>("div:has(> [data-scroll-footer])");
      if (!scroller) return "failedShift";
      return true;
    },
  },
  {
    id: "rail",
    label: "checkRail",
    block: "cardMotion",
    check() {
      const overlay = document.querySelector("[data-scroll-overlay]");
      if (!overlay) return null;
      // 浮层列里除卡片外的可交互子元素就是导航条; 它必须还带 .my-auto, 规则才选得中
      const others = Array.from(overlay.children).filter(
        (el) => !el.matches("[data-thread-context-card], span[aria-hidden]") && getComputedStyle(el).pointerEvents !== "none",
      );
      if (others.length === 0) return null;
      return others.every((el) => el.classList.contains("my-auto")) ? true : "failedRail";
    },
  },
  {
    id: "cursor",
    label: "checkCursor",
    block: "desktopCursor",
    check() {
      const buttons = Array.from(document.querySelectorAll<HTMLElement>("button:not(:disabled), a[data-sidebar-thread-id]"))
        .filter((el) => el.offsetParent !== null && !el.closest("[data-timeline-row-id]"))
        .slice(0, 80);
      if (buttons.length < 5) return null;
      const hands = buttons.filter((el) => getComputedStyle(el).cursor === "pointer");
      // 个别第三方控件可能自带手形, 不算失效; 超过两成才说明 bb 换了加手形的方式
      return hands.length <= buttons.length * 0.2
        ? true
        : "failedCursor";
    },
  },
  {
    // 反向自检: 光标规则不许波及消息正文 (正文要能显示文字光标, 才看得出可以选字 Add to chat)
    id: "text",
    label: "checkText",
    block: "desktopCursor",
    check() {
      const blocks = Array.from(document.querySelectorAll<HTMLElement>("[data-timeline-row-id] :is(p, li, td)"))
        // 本身就在可点控件里的段落 (bb 用完整类名 cursor-pointer 标的) 是箭头才对, 不算
        .filter((el) => el.offsetParent !== null && !el.closest('a, button, [role=button], [class~="cursor-pointer"]'))
        .slice(0, 40);
      if (blocks.length === 0) return null;
      const arrows = blocks.filter((el) => getComputedStyle(el).cursor === "default");
      return arrows.length === 0
        ? true
        : "failedText";
    },
  },
];

let results: HookResult[] = [];
let checkedAt: number | null = null;
const healthListeners = new Set<() => void>();
let snapshot: { results: HookResult[]; checkedAt: number | null } = { results, checkedAt };

const HEALTH_KEY = "bb-plugin-session-cockpit:host-health:v2";

/** 上次在线程页上查到的结果; 设置页上没有线程视图, 靠它显示"最近一次的结论" */
function loadStored(): HookResult[] {
  try {
    const stored = JSON.parse(localStorage.getItem(HEALTH_KEY) ?? "[]") as unknown;
    return Array.isArray(stored) ? (stored.filter((r) => r && typeof r === "object" && typeof (r as HookResult).id === "string") as HookResult[]) : [];
  } catch {
    return [];
  }
}

function runChecks(): HookResult[] {
  const prefs = readPrefs();
  const previous = new Map((results.length > 0 ? results : loadStored()).map((r) => [r.id, r]));
  results = HOOKS.map((hook) => {
    if (hook.block && !prefs.hostStyles[hook.block]) return { id: hook.id, label: hook.label, status: "off" as const, detail: null };
    let outcome: null | true | MessageKey;
    try {
      outcome = hook.check();
    } catch {
      outcome = "checkFailed";
    }
    if (outcome === null) {
      // 前提不满足 (不在线程页、卡片没开): 保留上一次的有效结论, 不把它冲成"未检查"
      const last = previous.get(hook.id);
      if (last && (last.status === "ok" || last.status === "broken")) return { ...last, label: hook.label };
      return { id: hook.id, label: hook.label, status: "skipped" as const, detail: null };
    }
    return { id: hook.id, label: hook.label, status: outcome === true ? ("ok" as const) : ("broken" as const), detail: outcome === true ? null : outcome };
  });
  checkedAt = Date.now();
  try {
    localStorage.setItem(HEALTH_KEY, JSON.stringify(results));
  } catch {
    // 存不进去只影响设置页的"上次结论"
  }
  snapshot = { results, checkedAt };
  for (const listener of healthListeners) listener();
  return results;
}

/** 给 agent 的修复指令: 失效时复制给任意线程即可 */
export function repairPrompt(t: Text, broken: readonly HookResult[]) {
  return [t("fixPrompt"), ...broken.map(r => `- ${t(r.label)} · ${t(r.detail ?? "checkFailed")}`)].join("\n");
}

const NOTIFIED_KEY = "bb-plugin-session-cockpit:host-health-notified";
const RENOTIFY_MS = 24 * 3600_000;

/** 同一组失效 24 小时内只提醒一次 */
function notifyIfBroken(current: HookResult[]) {
  const broken = current.filter((r) => r.status === "broken");
  if (broken.length === 0) return;
  const key = broken.map((r) => r.id).sort().join(",");
  try {
    const last = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? "null") as { key: string; at: number } | null;
    if (last && last.key === key && Date.now() - last.at < RENOTIFY_MS) return;
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify({ key, at: Date.now() }));
  } catch {
    // 读写失败就照常提醒
  }
  const t = currentText();
  toast.warning(t("polishWarning"), {
    description: t("polishWarningHelp"),
    id: "session-cockpit:host-warning",
    duration: 20_000,
    action: {
      label: t("copyFix"),
      onClick: () => void copyToClipboard({ text: repairPrompt(currentText(), broken) }).then(ok => ok && notifyCockpit("success", "copied")),
    },
  });
}

export function recheckHostHealth(): HookResult[] {
  return runChecks();
}

export function useHostHealth() {
  return useSyncExternalStore(
    (listener) => {
      healthListeners.add(listener);
      return () => healthListeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
  );
}

// ---------------------------------------------------------------------------
// 内容脚本入口
// ---------------------------------------------------------------------------

const STYLE_ID = "bb-plugin-session-cockpit-host-styles";
/** 页面稳定后再查; 之后低频复查, 覆盖"用户后来才打开线程页"的情况 */
const FIRST_CHECK_MS = 6000;
const RECHECK_MS = 60_000;

export function mountHostStyles({ signal }: { signal: AbortSignal }): () => void {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  const apply = () => {
    const { hostStyles, display } = readPrefs();
    document.documentElement.style.setProperty(HEIGHT_VAR, `${display.cardHeight}px`);
    style.textContent = CARD_HEIGHT_CSS + (hostStyles.cardMotion ? CARD_MOTION_CSS : "") + (hostStyles.desktopCursor ? CURSOR_CSS : "");
  };
  apply();
  document.head.appendChild(style);
  const unsubscribe = subscribePrefs(apply);

  const check = () => {
    if (document.visibilityState === "visible") notifyIfBroken(runChecks());
  };
  const first = setTimeout(check, FIRST_CHECK_MS);
  const timer = setInterval(check, RECHECK_MS);

  // 在会话之间切换时, 卡片应当像同一张卡片留在原地、只换内容, 而不是滑出去再滑进来。
  // bb 切换会话会重建整个线程视图 (卡片是新节点), 所以这里在导航发生、且此刻卡片开着时打一个短暂的标记, 让新卡片跳过入场动画。
  const navigation = (globalThis as { navigation?: EventTarget }).navigation;
  let warm: ReturnType<typeof setTimeout> | undefined;
  const CARD = "[data-scroll-overlay] > [data-thread-context-card]:not([hidden])";
  const root = document.documentElement;
  const clearWarm = () => {
    root.removeAttribute(WARM_ATTR);
    root.style.removeProperty(HOLD_VAR);
  };
  /** 新会话的内容到齐后: 量出卡片自己的高度, 让 min-height 从旧高度过渡过去, 再撤掉全部标记 */
  const settle = () => {
    const card = document.querySelector<HTMLElement>(CARD);
    if (!card) return clearWarm();
    root.setAttribute(WARM_ATTR, "settle");
    card.style.transition = "none";
    card.style.minHeight = "0px";
    const natural = Math.round(card.getBoundingClientRect().height);
    // 先在"过渡仍关着"时回到旧高度并让浏览器算一次样式 (否则 0 → 旧高度这一步自己就会被当成过渡),
    // 再恢复过渡、改变量: 这样过渡的起点是旧高度, 终点是新内容的实际高度
    card.style.minHeight = "";
    void card.offsetHeight;
    card.style.transition = "";
    void card.offsetHeight;
    root.style.setProperty(HOLD_VAR, `${natural}px`);
    warm = setTimeout(clearWarm, SETTLE_MS);
  };
  const onNavigate = () => {
    const card = document.querySelector(CARD);
    if (!card) return;
    clearTimeout(warm);
    root.style.setProperty(HOLD_VAR, `${Math.round(card.getBoundingClientRect().height)}px`);
    root.setAttribute(WARM_ATTR, "hold");
    warm = setTimeout(settle, WARM_MS);
  };
  navigation?.addEventListener("navigate", onNavigate);

  const dispose = () => {
    clearTimeout(first);
    clearInterval(timer);
    clearTimeout(warm);
    navigation?.removeEventListener("navigate", onNavigate);
    clearWarm();
    unsubscribe();
    style.remove();
    root.style.removeProperty(HEIGHT_VAR);
  };
  signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}
