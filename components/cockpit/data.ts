/**
 * [INPUT]: 依赖 @get-bb/plugin-sdk/app 的 experimental_useRpcQuery, 依赖 rpc.ts 契约
 * [OUTPUT]: 对外提供 useSession / useServers / useContextFiles / useSideChats / useScripts / useNow: 卡片分区的数据入口
 * [POS]: components/cockpit 的数据层; 消费者: 本目录全部分区; 与 prefs.ts 的边界: 本文件只读服务端数据, 客户端偏好在 prefs.ts
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useEffect, useRef, useState } from "react";
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { rpcContract } from "../../rpc";

/** 会话快照: 服务端在线程事件推进时失效刷新, 这里无需轮询 */
export function useSession(threadId: string) {
  return experimental_useRpcQuery({
    contract: rpcContract,
    method: "session",
    input: { threadId },
  });
}

/**
 * 没有事件可依的数据靠它保持新鲜: poll 为真 (项展开着) 时立刻重取一次, 之后页面可见时每 intervalMs 重取。
 *
 * SDK 的 refetch 每次渲染都是新函数, 绝不能进 effect 依赖: 否则"刷新 → isFetching 变化重渲染 → effect 重跑 → 再刷新"
 * 无限循环 (实测每秒约 420 次 servers 调用, 前端持续重渲染、后端持续忙, 是点击卡顿的头号嫌疑)。用 ref 取最新的 refetch。
 */
function usePollWhile(refetch: () => unknown, poll: boolean, intervalMs: number) {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    if (!poll) return;
    void refetchRef.current();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refetchRef.current();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [poll, intervalMs]);
}

/**
 * Servers 没有事件可依。挂载时扫一次; 只有 poll 为真 (分区展开) 且页面可见时才每 30 秒重扫。
 * 宿主端对同一工作区 5 秒内的扫描去重、HTTP 探测按 pid:端口缓存 60 秒。
 */
export function useServers(threadId: string, poll: boolean, intervalMs = 30_000) {
  const query = experimental_useRpcQuery({
    contract: rpcContract,
    method: "servers",
    input: { threadId },
  });
  usePollWhile(query.refetch, poll, intervalMs);
  return query;
}

/**
 * 线程工作区的上下文文件。挂载时取一次, 回合结束时服务端失效刷新; 用户自己在编辑器里改文件没有事件,
 * 所以项展开着时每 30 秒重取 ("有改动"要显得新)。服务端与宿主端各缓存 15 秒。
 */
export function useContextFiles(threadId: string, poll: boolean, intervalMs = 30_000) {
  const query = experimental_useRpcQuery({
    contract: rpcContract,
    method: "contextFiles",
    input: { threadId },
  });
  usePollWhile(query.refetch, poll, intervalMs);
  return query;
}

export function useSideChats(threadId: string) {
  return experimental_useRpcQuery({
    contract: rpcContract,
    method: "sideChats",
    input: { threadId },
  });
}

export function useScripts(projectId: string) {
  return experimental_useRpcQuery({
    contract: rpcContract,
    method: "scripts",
    input: { projectId },
  });
}

/** 倒计时用的时钟; 每个组件按自己的精度订阅 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
