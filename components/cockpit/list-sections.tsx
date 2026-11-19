/**
 * [INPUT]: 依赖双语的服务归属、命令操作及 依赖 data.ts (useSession/useServers/useScripts/useSideChats/useNow)、rpc.ts 契约、宿主 useSdk (terminals)、useBbNavigate、copyToClipboard
 * [OUTPUT]: 对外提供 ConnectorsSection / ServersSection / ScriptsSection / SideChatsSection: 列表型分区 (一行摘要 → 就地展开为列表)
 * [POS]: components/cockpit 的列表分区, 对应 Claude Desktop 的 Connectors 与 T3 Code 的 Servers / Project scripts / Side chats;
 *        消费者: cockpit.tsx; 与 context-section.tsx 的边界: 连接器只到 server 级, 工具明细在上下文分类里展开
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useTranslation, useText, notifyCockpit } from "./language";
import { useState } from "react";
import {
  experimental_copyToClipboard as copyToClipboard,
  useBbNavigate,
  useRpc,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { matchingProse, type Text } from "../../lib/i18n";
import { Input } from "@/components/ui/input";
import type { ListenerInfo } from "../../contract";
import type { ProjectScript, rpcContract } from "../../rpc";
import { useNow, useScripts, useServers, useSession, useSideChats } from "./data";
import type { SectionProps } from "./cockpit";
import { CardRow, Dot, MenuConfirmItem, MenuItem, MoreRow, SectionBody, SectionRow } from "./rows";

/** 14px 槽位里的圆点, 与图标对齐 */
const DotSlot = ({ color, label }: { color: string; label: string }) => (
  <span className="flex size-3.5 shrink-0 items-center justify-center">
    <Dot color={color} label={label} />
  </span>
);

// ---------------------------------------------------------------------------
// Connectors (Claude Desktop): 从上下文里的 MCP 工具条目反推
// ---------------------------------------------------------------------------

export function ConnectorsSection({ threadId, open, onToggle }: SectionProps) {
  const { t, formatTokens } = useTranslation();
  const connectors = useSession(threadId).data?.connectors ?? [];
  if (connectors.length === 0) return null;
  const loaded = connectors.filter((c) => c.loadedTools > 0).length;
  return (
    <div>
      <SectionRow
        icon="Plug02"
        label={t("connectors")}
        open={open}
        onToggle={onToggle}
        summary={loaded > 0 ? `${connectors.length} · ${t("loaded", { count: loaded })}` : String(connectors.length)}
      />
      <SectionBody open={open}>
        {connectors.map((c) => (
            <CardRow
              key={c.name}
              leading={
                <DotSlot
                  color={c.loadedTools > 0 ? "var(--success)" : "var(--muted-foreground)"}
                  label={c.loadedTools > 0 ? t("toolsLoaded") : t("toolsOnDemand")}
                />
              }
              label={c.name}
              title={t("connectorHelp", { activeCount: t("loaded", { count: c.loadedTools }), deferredCount: t("onDemandCount", { count: c.deferredTools }), size: t("tokens", { count: formatTokens(c.tokens) }) })}
              trailing={c.loadedTools > 0 ? t("loaded", { count: c.loadedTools }) : t("onDemandCount", { count: c.deferredTools })}
            />
          ))}
        </SectionBody>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Servers (T3 Code): 本工作区里自己起的服务在前, agent 会话与其他进程的端口折叠
// ---------------------------------------------------------------------------

export function ServersSection({ threadId, open, onToggle }: SectionProps) {
  const t = useText();
  // 收起时只在挂载时扫一次 (给摘要一个数), 展开后才定期重扫
  const result = useServers(threadId, open).data;
  const [showOther, setShowOther] = useState(false);
  if (!result?.supported || result.servers.length === 0) return null;
  // 本线程的: 可停止, 且进程环境里的线程 id 是本线程 (读不到线程 id 的, 如 docker, 也算工作区自己的)
  const mine = result.servers.filter((s) => s.stoppable && (s.threadId === null || s.threadId === threadId));
  const other = result.servers.filter((s) => !mine.includes(s));
  return (
    <div>
      <SectionRow
        icon="Globe"
        label={t("servers")}
        open={open}
        onToggle={onToggle}
        summary={mine.length > 0 ? t("runningCount", { count: mine.length }) : t(other.length === 1 ? "otherPort" : "otherPorts", { count: other.length })}
      />
      <SectionBody open={open}>
        <>
          {mine.map((s) => (
            <ServerRow key={`${s.pid}:${s.port}`} threadId={threadId} server={s} />
          ))}
          {mine.length > 0 && other.length > 0 ? (
            <MoreRow
              label={showOther ? t("hidePorts") : t("otherThreadsPorts", { count: other.length })}
              open={showOther}
              onToggle={() => setShowOther(!showOther)}
            />
          ) : null}
          {mine.length === 0 || showOther ? other.map((s) => <ServerRow key={`${s.pid}:${s.port}`} threadId={threadId} server={s} />) : null}
        </>
      </SectionBody>
    </div>
  );
}

/** T3 式归属文案: "Agent · node" / "Terminal · python3" / "claude session" */
function ownerText(t: Text, server: ListenerInfo, threadId: string): string {
  const elsewhere = server.threadId !== null && server.threadId !== threadId ? `${t("otherThread")} · ` : "";
  switch (server.owner) {
    case "agent":
      return elsewhere + t("agentSession", { name: server.ownerAgent ?? t("agent") });
    case "agent-child":
      return elsewhere + `${t("agent")} · ${server.label}`;
    case "terminal":
      return elsewhere + `${t("terminal")} · ${server.label}`;
    case "docker":
      return elsewhere + `Docker · ${server.label}`;
    default:
      return server.label;
  }
}

function ServerRow({ threadId, server }: { threadId: string; server: ListenerInfo }) {
  const t = useText();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const host = server.url.replace(/^https?:\/\//, "");
  const openable = server.http !== false;
  const open = () => navigate.openUrl(server.url);
  return (
    <CardRow
      icon="Globe"
      // 地址是这一行的身份, 放不下时让右侧归属说明截断; 完整信息在悬停提示里
      priority="label"
      label={server.name ? `${server.name} :${server.port}` : host}
      title={[
        server.name ? `${server.name} · ${host}` : host,
        ownerText(t, server, threadId),
        server.container ? t("container", { name: server.container }) : t("process", { pid: server.pid }),
        server.cwd,
      ]
        .filter(Boolean)
        .join(" · ")}
      trailing={ownerText(t, server, threadId)}
      onClick={openable ? open : undefined}
      menuLabel={t("actionsFor", { name: host })}
      menu={
        <>
          {openable ? <MenuItem icon="ExternalLink" label={t("open")} onSelect={open} /> : null}
          <MenuItem icon="Copy" label={t("copyUrl")} onSelect={() => void copyToClipboard({ text: server.url }).then((ok) => ok && notifyCockpit("success", "copied"))} />
          {server.stoppable ? (
            <MenuConfirmItem
              icon="Square"
              label={t("stop", { name: server.label })}
              // 确认文案不长于原文案, 菜单宽度不跳; 触屏上也成立 (不写 "Click")
              confirmLabel={t("confirmStop")}
              onConfirm={async () => {
                try {
                  const result = await rpc.call("stopServer", { threadId, pid: server.pid, port: server.port });
                  notifyCockpit(result.stopped ? "success" : "error", result.stopped ? "stopped" : "stopFailed");
                } catch {
                  notifyCockpit("error", "stopFailed");
                }
              }}
            />
          ) : null}
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Project scripts (T3 Code): 点击即在线程终端运行
// ---------------------------------------------------------------------------

export function ScriptsSection({ threadId, projectId, open, onToggle }: SectionProps) {
  const t = useText();
  const query = useScripts(projectId);
  const [editing, setEditing] = useState<ProjectScript | "new" | null>(null);
  const scripts = query.data?.scripts ?? [];
  return (
    <div>
      <SectionRow icon="Terminal" label={t("scripts")} open={open} onToggle={onToggle} summary={scripts.length > 0 ? String(scripts.length) : t("add")} />
      <SectionBody open={open}>
        <>
          {scripts.map((script) =>
            editing !== "new" && editing?.id === script.id ? (
              <ScriptForm key={script.id} projectId={projectId} script={script} onDone={() => setEditing(null)} />
            ) : (
              <ScriptRow key={script.id} threadId={threadId} projectId={projectId} script={script} onEdit={() => setEditing(script)} />
            ),
          )}
          {editing === "new" ? (
            <ScriptForm projectId={projectId} script={null} onDone={() => setEditing(null)} />
          ) : (
            <CardRow icon="Plus" label={t("addScript")} muted onClick={() => setEditing("new")} />
          )}
        </>
      </SectionBody>
    </div>
  );
}

/** 运行后等服务起来再开预览 */
const PREVIEW_DELAY_MS = 2000;

function ScriptRow({ threadId, projectId, script, onEdit }: { threadId: string; projectId: string; script: ProjectScript; onEdit: () => void }) {
  const { t, language } = useTranslation();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const [running, setRunning] = useState(false);
  const previewUrl = script.previewUrl;
  const name = language === "en" && /\p{Script=Han}/u.test(script.name) ? t("scriptName") : script.name;
  const run = async () => {
    if (running) return;
    setRunning(true);
    try {
      // 先开交互 shell 再键入命令: command 模式下进程一结束终端就关, 短命令的输出会丢
      const terminal = await sdk.terminals.create({
        scope: { kind: "thread", threadId },
        start: { mode: "shell" },
        title: script.name,
        cols: 120,
        rows: 32,
      });
      await sdk.terminals.input({ terminalId: terminal.id, dataBase64: toBase64(`${script.command}\r`) });
      const shown = await navigate.experimental_openTerminal({ terminalId: terminal.id });
      if (!shown) notifyCockpit("success", "started", { name });
      if (previewUrl) setTimeout(() => navigate.openUrl(previewUrl), PREVIEW_DELAY_MS);
    } catch {
      notifyCockpit("error", "startFailed");
    } finally {
      setRunning(false);
    }
  };
  return (
    <CardRow
      icon="Play"
      label={name}
      title={previewUrl ? t("scriptRunPreview", { command: script.command, url: previewUrl }) : t("scriptRun", { command: script.command })}
      trailing={previewUrl ? previewUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : undefined}
      onClick={() => void run()}
      menuLabel={t("actionsFor", { name })}
      menu={
        <>
          <MenuItem icon="Play" label={t("run")} onSelect={() => void run()} />
          {previewUrl ? <MenuItem icon="ExternalLink" label={t("openPreview")} onSelect={() => navigate.openUrl(previewUrl)} /> : null}
          <MenuItem icon="Copy" label={t("copyCommand")} onSelect={() => void copyToClipboard({ text: script.command }).then((ok) => ok && notifyCockpit("success", "copied"))} />
          <MenuItem icon="Edit" label={t("edit")} onSelect={onEdit} />
          <MenuConfirmItem
            icon="Trash2"
            label={t("remove")}
            confirmLabel={t("confirmRemove")}
            onConfirm={() => rpc.call("removeScript", { projectId, id: script.id }).then(() => undefined, () => void notifyCockpit("error", "removeFailed"))}
          />
        </>
      }
    />
  );
}

/** UTF-8 安全的 base64 (btoa 只接受 Latin-1, 命令里可能有中文路径) */
function toBase64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function ScriptForm({ projectId, script, onDone }: { projectId: string; script: ProjectScript | null; onDone: () => void }) {
  const t = useText();
  const rpc = useRpc<typeof rpcContract>();
  const [name, setName] = useState(script?.name ?? "");
  const [command, setCommand] = useState(script?.command ?? "");
  const [previewUrl, setPreviewUrl] = useState(script?.previewUrl ?? "");
  const [saving, setSaving] = useState(false);
  const preview = previewUrl.trim();
  const previewOk = preview === "" || /^https?:\/\/\S+$/i.test(preview);
  const valid = name.trim() !== "" && command.trim() !== "" && previewOk;
  const submit = async (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      await rpc.call("saveScript", { projectId, ...(script ? { id: script.id } : {}), name: name.trim(), command: command.trim(), previewUrl: preview === "" ? null : preview });
      onDone();
    } catch {
      notifyCockpit("error", "saveFailed");
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => e.key === "Escape" && onDone()}
      className="space-y-1 rounded-md bg-state-hover p-1.5"
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("scriptNameExample")} aria-label={t("scriptName")} className="h-7 px-2 text-xs" autoFocus />
      <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder={t("commandExample")} aria-label={t("command")} className="h-7 px-2 font-mono text-[11px]" />
      <Input
        value={previewUrl}
        onChange={(e) => setPreviewUrl(e.target.value)}
        placeholder={t("previewExample")}
        aria-label={t("previewUrl")}
        aria-invalid={!previewOk}
        className="h-7 px-2 font-mono text-[11px]"
      />
      <div className="flex items-center justify-end gap-1 pt-0.5">
        <span className="mr-auto pl-0.5 text-[11px] text-muted-foreground">{t("keyboardSave")}</span>
        <button type="button" className="h-6 rounded px-2 text-[11px] text-muted-foreground hover:bg-state-hover hover:text-foreground" onClick={onDone}>
          {t("cancel")}
        </button>
        <button
          type="submit"
          className="h-6 rounded bg-foreground px-2 text-[11px] text-background hover:bg-foreground/90 disabled:opacity-40"
          disabled={!valid || saving}
        >
          {saving ? t("saving") : t(script ? "save" : "add")}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Side chats (T3 Code): bb 内置 side-chat 插件建的隐藏 fork
// ---------------------------------------------------------------------------

export function SideChatsSection({ threadId, open, onToggle }: SectionProps) {
  const { t, language, formatAgo } = useTranslation();
  const query = useSideChats(threadId);
  const chats = query.data?.chats ?? [];
  const navigate = useBbNavigate();
  const sdk = useSdk();
  const now = useNow(60_000);
  const [renaming, setRenaming] = useState<string | null>(null);
  if (chats.length === 0) return null;
  const working = chats.filter((c) => c.status === "active" || c.status === "starting").length;
  const rename = async (id: string, title: string) => {
    setRenaming(null);
    const next = title.trim();
    // 空名或没改: 当作取消, 不发请求
    if (next === "" || next === (chats.find((c) => c.id === id)?.title ?? "")) return;
    try {
      await sdk.threads.update({ threadId: id, title: next });
      await query.refetch();
    } catch {
      notifyCockpit("error", "renameFailed");
    }
  };
  return (
    <div>
      <SectionRow
        icon="SideChat"
        label={t("sideChats")}
        open={open}
        onToggle={onToggle}
        summary={working > 0 ? `${chats.length} · ${t("runningCount", { count: working })}` : String(chats.length)}
      />
      <SectionBody open={open}>
        {chats.map((chat) => {
          const busy = chat.status === "active" || chat.status === "starting";
          const openChat = () => navigate.toThread(chat.id, { split: true });
          if (renaming === chat.id) {
            return (
              <form
                key={chat.id}
                className="px-1 py-0.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void rename(chat.id, new FormData(e.currentTarget).get("title")?.toString() ?? "");
                }}
                onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
              >
                <Input name="title" defaultValue={chat.title ?? ""} placeholder={t("sideChatName")} aria-label={t("sideChatName")} className="h-7 px-2 text-xs" autoFocus onBlur={() => setRenaming(null)} />
              </form>
            );
          }
          return (
            <CardRow
              key={chat.id}
              icon="SideChat"
              label={matchingProse(language, chat.title) ?? t("untitledSideChat")}
              onClick={openChat}
              menuLabel={t("moreActions")}
              menu={
                <>
                  <MenuItem icon="Columns2" label={t("openSplit")} onSelect={openChat} />
                  <MenuItem icon="Edit" label={t("rename")} onSelect={() => setRenaming(chat.id)} />
                </>
              }
              trailing={
                busy ? (
                  <>
                    <Dot color="var(--success)" />
                    <span>{t("working")}</span>
                  </>
                ) : (
                  formatAgo(chat.updatedAt, now)
                )
              }
            />
          );
        })}
      </SectionBody>
    </div>
  );
}
