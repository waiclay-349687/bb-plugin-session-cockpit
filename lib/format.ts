/**
 * [INPUT]: 无外部依赖, 只用 Intl
 * [OUTPUT]: 对外提供 formatTokens / formatPercent / formatDuration / formatCountdown / formatCost: 面板与 CLI 共用的紧凑显示格式
 * [POS]: lib 层的显示格式化; 消费者: app 组件、server.ts 的 CLI 文本输出、test; 与 lib/usage.ts 的边界: 本文件不做任何业务推算
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** 135800 → "135.8k", 1000000 → "1M" (与 Claude Desktop 的写法一致) */
export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value < 1000) return String(Math.round(value));
  return compact.format(value).replace("K", "k");
}

/** 0.0876 → "8.8%"; 小于 0.1% 但非 0 时写 "<0.1%" 以免误读为 0 */
export function formatPercent(
  ratio: number | null | undefined,
  digits = 1,
): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  const percent = ratio * 100;
  if (percent > 0 && percent < 0.1) return "<0.1%";
  return `${percent.toFixed(digits).replace(/\.0$/, "")}%`;
}

/** 毫秒 → "3h 34m" / "12m" / "45s"; 最多两级单位 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/** 到某个时间点还剩多久: "1d 11h"; 已过期返回 "now" */
export function formatCountdown(targetMs: number | null, now: number): string {
  if (targetMs === null) return "—";
  const remaining = targetMs - now;
  return remaining <= 0 ? "now" : formatDuration(remaining);
}

/** 距今多久: "3m ago" */
export function formatAgo(pastMs: number | null, now: number): string {
  if (pastMs === null) return "—";
  const elapsed = now - pastMs;
  if (elapsed < 30_000) return "just now";
  return `${formatDuration(elapsed)} ago`;
}

export function formatCost(
  cost: { amount: number; currency: string } | null | undefined,
): string {
  if (!cost) return "—";
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: cost.currency,
      maximumFractionDigits: cost.amount < 1 ? 3 : 2,
    }).format(cost.amount);
  } catch {
    return `${cost.amount.toFixed(2)} ${cost.currency}`;
  }
}

/** TTL 毫秒 → "1 hour" / "5 minutes" */
export function formatTtl(ms: number | null): string {
  if (ms === null) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
