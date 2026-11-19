/**
 * [INPUT]: 依赖 data.ts (useSession/useServers/useScripts/useSideChats/useNow)、rpc.ts 契约、宿主 useSdk (terminals)、useBbNavigate、copyToClipboard
 * [OUTPUT]: 对外提供 ConnectorsSection / ServersSection / ScriptsSection / SideChatsSection: 列表型分区 (一行摘要 → 就地展开为列表)
 * [POS]: components/cockpit 的列表分区, 对应 Claude Desktop 的 Connectors 与 T3 Code 的 Servers / Project scripts / Side chats;
 *        消费者: cockpit.tsx; 与 context-section.tsx 的边界: 连接器只到 server 级, 工具明细在上下文分类里展开
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
import { useState } from "react";
import {
  experimental_copyToClipboard as copyToClipboard,
  useBbNavigate,
  useRpc,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import type { ListenerInfo } from "../../contract";
import type { ProjectScript, rpcContract } from "../../rpc";
import { formatAgo, formatTokens } from "../../lib/format";
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
  const connectors = useSession(threadId).data?.connectors ?? [];
  if (connectors.length === 0) return null;
  const loaded = connectors.filter((c) => c.loadedTools > 0).length;
  return (
    <div>
      <SectionRow
        icon="Plug02"
        label="Connectors"
        open={open}
        onToggle={onToggle}
        summary={loaded > 0 ? `${connectors.length} · ${loaded} loaded` : String(connectors.length)}
      />
      <SectionBody open={open}>
        {connectors.map((c) => (
            <CardRow
              key={c.name}
              leading={
                <DotSlot
                  color={c.loadedTools > 0 ? "var(--success)" : "var(--muted-foreground)"}
                  label={c.loadedTools > 0 ? "Tools loaded" : "Tools load on demand"}
                />
              }
              label={c.name}
              title={`${c.loadedTools} loaded, ${c.deferredTools} on demand · ${formatTokens(c.tokens)} tokens. Read from this session's context; servers that failed to connect don't appear.`}
              trailing={c.loadedTools > 0 ? `${c.loadedTools} loaded` : `${c.deferredTools} on demand`}
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
        label="Servers"
        open={open}
        onToggle={onToggle}
        summary={mine.length > 0 ? `${mine.length} running` : `${other.length} other port${other.length === 1 ? "" : "s"}`}
      />
      <SectionBody open={open}>
        <>
          {mine.map((s) => (
            <ServerRow key={`${s.pid}:${s.port}`} threadId={threadId} server={s} />
          ))}
          {mine.length > 0 && other.length > 0 ? (
            <MoreRow
              label={showOther ? "Hide other ports" : `${other.length} from agents & other threads`}
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
function ownerText(server: ListenerInfo, threadId: string): string {
  const elsewhere = server.threadId !== null && server.threadId !== threadId ? "Other thread · " : "";
  switch (server.owner) {
    case "agent":
      return elsewhere + `${server.ownerAgent ?? "agent"} session`;
    case "agent-child":
      return elsewhere + `Agent · ${server.label}`;
    case "terminal":
      return elsewhere + `Terminal · ${server.label}`;
    case "docker":
      return elsewhere + `Docker · ${server.label}`;
    default:
      return server.label;
  }
}

function ServerRow({ threadId, server }: { threadId: string; server: ListenerInfo }) {
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
        ownerText(server, threadId),
        server.container ? `container ${server.container}` : `pid ${server.pid}`,
        server.cwd,
      ]
        .filter(Boolean)
        .join(" · ")}
      trailing={ownerText(server, threadId)}
      onClick={openable ? open : undefined}
      menuLabel={`Actions for ${host}`}
      menu={
        <>
          {openable ? <MenuItem icon="ExternalLink" label="Open" onSelect={open} /> : null}
          <MenuItem icon="Copy" label="Copy URL" onSelect={() => void copyToClipboard({ text: server.url }).then((ok) => ok && toast.success("Copied"))} />
          {server.stoppable ? (
            <MenuConfirmItem
              icon="Square"
              label={`Stop ${server.label}`}
              // 确认文案不长于原文案, 菜单宽度不跳; 触屏上也成立 (不写 "Click")
              confirmLabel="Confirm stop"
              onConfirm={async () => {
                try {
                  const result = await rpc.call("stopServer", { threadId, pid: server.pid, port: server.port });
                  (result.stopped ? toast.success : toast.error)(result.message);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not stop the server");
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
  const query = useScripts(projectId);
  const [editing, setEditing] = useState<ProjectScript | "new" | null>(null);
  const scripts = query.data?.scripts ?? [];
  return (
    <div>
      <SectionRow icon="Terminal" label="Scripts" open={open} onToggle={onToggle} summary={scripts.length > 0 ? String(scripts.length) : "Add"} />
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
            <CardRow icon="Plus" label="Add project script" muted onClick={() => setEditing("new")} />
          )}
        </>
      </SectionBody>
    </div>
  );
}

/** 运行后等服务起来再开预览 */
const PREVIEW_DELAY_MS = 2000;

function ScriptRow({ threadId, projectId, script, onEdit }: { threadId: string; projectId: string; script: ProjectScript; onEdit: () => void }) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const [running, setRunning] = useState(false);
  const previewUrl = script.previewUrl;
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
      if (!shown) toast.success(`Started "${script.name}" in a terminal`);
      if (previewUrl) setTimeout(() => navigate.openUrl(previewUrl), PREVIEW_DELAY_MS);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start the script");
    } finally {
      setRunning(false);
    }
  };
  return (
    <CardRow
      icon="Play"
      label={script.name}
      title={`Run: ${script.command}${previewUrl ? `, then open ${previewUrl}` : ""}`}
      trailing={previewUrl ? previewUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : undefined}
      onClick={() => void run()}
      menuLabel={`Actions for ${script.name}`}
      menu={
        <>
          <MenuItem icon="Play" label="Run" onSelect={() => void run()} />
          {previewUrl ? <MenuItem icon="ExternalLink" label="Open preview" onSelect={() => navigate.openUrl(previewUrl)} /> : null}
          <MenuItem icon="Copy" label="Copy command" onSelect={() => void copyToClipboard({ text: script.command }).then((ok) => ok && toast.success("Copied"))} />
          <MenuItem icon="Edit" label="Edit" onSelect={onEdit} />
          <MenuConfirmItem
            icon="Trash2"
            label="Remove"
            confirmLabel="Confirm remove"
            onConfirm={() => rpc.call("removeScript", { projectId, id: script.id }).then(() => undefined, (e: unknown) => void toast.error(String(e)))}
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the script");
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
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name · Dev server" aria-label="Script name" className="h-7 px-2 text-xs" autoFocus />
      <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Command · npm run dev" aria-label="Command" className="h-7 px-2 font-mono text-[11px]" />
      <Input
        value={previewUrl}
        onChange={(e) => setPreviewUrl(e.target.value)}
        placeholder="Preview URL (optional) · http://localhost:5173"
        aria-label="Preview URL"
        aria-invalid={!previewOk}
        className="h-7 px-2 font-mono text-[11px]"
      />
      <div className="flex items-center justify-end gap-1 pt-0.5">
        <span className="mr-auto pl-0.5 text-[11px] text-muted-foreground">Enter to save · Esc to cancel</span>
        <button type="button" className="h-6 rounded px-2 text-[11px] text-muted-foreground hover:bg-state-hover hover:text-foreground" onClick={onDone}>
          Cancel
        </button>
        <button
          type="submit"
          className="h-6 rounded bg-foreground px-2 text-[11px] text-background hover:bg-foreground/90 disabled:opacity-40"
          disabled={!valid || saving}
        >
          {script ? "Save" : "Add"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Side chats (T3 Code): bb 内置 side-chat 插件建的隐藏 fork
// ---------------------------------------------------------------------------

export function SideChatsSection({ threadId, open, onToggle }: SectionProps) {
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not rename the side chat");
    }
  };
  return (
    <div>
      <SectionRow
        icon="SideChat"
        label="Side chats"
        open={open}
        onToggle={onToggle}
        summary={working > 0 ? `${chats.length} · ${working} working` : String(chats.length)}
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
                <Input name="title" defaultValue={chat.title ?? ""} placeholder="Side chat name" aria-label="Side chat name" className="h-7 px-2 text-xs" autoFocus onBlur={() => setRenaming(null)} />
              </form>
            );
          }
          return (
            <CardRow
              key={chat.id}
              icon="SideChat"
              label={chat.title ?? "Untitled side chat"}
              onClick={openChat}
              menuLabel="Side chat actions"
              menu={
                <>
                  <MenuItem icon="Columns2" label="Open in split" onSelect={openChat} />
                  <MenuItem icon="Edit" label="Rename" onSelect={() => setRenaming(chat.id)} />
                </>
              }
              trailing={
                busy ? (
                  <>
                    <Dot color="var(--success)" />
                    <span>Working</span>
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
