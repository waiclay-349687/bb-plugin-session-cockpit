/**
 * [INPUT]: 宿主主题的 ANSI 色变量 (--ansi-1..8, bb 原生上下文弹层同款)
 * [OUTPUT]: 对外提供 categoryColor / meterTone: 上下文分类配色与用量阈值色调
 * [POS]: lib 层的视觉映射, 无 IO; 消费者: components/cockpit/*; 与 lib/format.ts 的边界: 本文件只决定颜色, 不产出文本
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */

// 固定分类固定颜色 (与 Claude Desktop 的配色语义接近: Messages 蓝、Memory 橙、Skills 青、System tools 黄),
// 走主题变量而不是写死色值, 自定义主题下依然协调
const FIXED: Record<string, string> = {
  Messages: "var(--ansi-4)",
  "Memory files": "var(--ansi-1)",
  Skills: "var(--ansi-6)",
  "System tools": "var(--ansi-3)",
  "System prompt": "var(--ansi-5)",
  "MCP tools": "var(--ansi-2)",
  "MCP server instructions": "var(--ansi-8)",
};
const CYCLE = ["var(--ansi-12)", "var(--ansi-13)", "var(--ansi-10)", "var(--ansi-14)", "var(--ansi-11)"];

export function categoryColor(label: string, kind: string, index: number): string {
  if (kind === "free" || kind === "reserved" || kind === "deferred") return "var(--muted-foreground)";
  return FIXED[label] ?? CYCLE[index % CYCLE.length]!;
}

export type Tone = "normal" | "warning" | "danger";

/** 与 usage-tracker / bb 原生一致: 80% 起黄, 95% 起红 */
export function meterTone(ratio: number | null): Tone {
  if (ratio === null) return "normal";
  if (ratio >= 0.95) return "danger";
  if (ratio >= 0.8) return "warning";
  return "normal";
}
