---
name: session-cockpit
description: Check this thread's context window, prompt-cache state, token usage and the dev servers listening in its workspace with `bb session-cockpit`. Use before starting a large task (is there room in the context window? is the weekly limit close?), before suggesting compaction, or when you need the URL of a dev server you started.
---

# Session Cockpit

The Session Cockpit plugin adds sections to the thread context card at the
upper right of every thread (Context, Usage, Servers, Scripts, Connectors,
Side chats). Agents read the same data from the CLI.

## Commands

```sh
bb session-cockpit summary [--thread <id>] [--json]
bb session-cockpit servers [--thread <id>] [--json]
```

Inside a thread, `--thread` defaults to the current thread.

- `summary` prints context used / window (with the provider's category
  breakdown when it reports one, Claude Code does), session token totals with
  the cache hit rate, whether the prompt cache is warm, cold or in use, session
  and agent working time, and each plan-limit window with its percentage and
  reset time. `--json` omits per-entry detail to stay small.
- `servers` lists TCP listeners inside the thread's workspace, one per line:
  `<url>  [<name>: ]<process> (pid <n> | container <name>)  [<owner>]` plus
  optional tags. The name comes from the workspace's `.bb/ports.json`
  (`{"ports":[{"port":5173,"label":"Web"}]}`). Owners: `[agent session]` is
  an agent CLI itself (its IDE/MCP port, never a dev server),
  `[started by <agent>]` was launched by an agent, `[terminal]` was launched
  in a bb terminal, `[docker]` is a port published by a docker compose
  project in the workspace, `[other]` is anything else.
  `[other thread <id>]` marks a process another bb thread started (from its
  `BB_THREAD_ID`); terminal and docker rows have no thread. `[not HTTP]` marks
  ports that did not answer an HTTP request (agent sessions' ports are not
  probed). `--json` adds `owner`, `threadId`, `container`, `name` and
  `stoppable` per server.

## How to use the numbers

- Context figures come from the provider and are often estimates; treat them
  as a budget, not an exact count. The breakdown refreshes after a turn ends.
- "Last turn" token counts are a whole turn's sum, not one request; do not use
  them as the context size.
- A cold cache means the next message re-reads the whole context uncached.
  Mention compaction to the user only when the context is large and the cache
  is about to expire or already cold; never compact on your own.
- Plan-limit percentages come from bb's provider usage service and can lag a
  few minutes.
- Stopping a server and editing project scripts are user actions in the card;
  the CLI is read-only.
