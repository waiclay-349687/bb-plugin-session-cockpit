Session details where you are already looking: a few compact sections in the
thread context card at the upper right of every thread, beside the
conversation, in the spirit of Claude Desktop's context column and T3 Code's
thread details. Each section is one summary line; open as many as you like
in place.

## What you get

- **Environment**: where this thread runs, as its own group of four rows —
  the project name (with a new-thread shortcut on hover), the path (hover for
  the full path, click to copy), a searchable read-only branch list, and
  uncommitted changes as green `+N` and red `−M` that open bb's Diff panel.
- **Context files**: every CLAUDE.md, AGENTS.md, rule and memory file that
  steers the agent, grouped by level (Global, Parent, Project, Modules, Local,
  Rules, Memory), with imports shown under the file that pulls them in. A dot
  and token count mark files loaded into this conversation, an `M` marks
  uncommitted changes. Large levels list only loaded and changed files and
  keep the rest in a searchable dialog grouped by top-level directory. Click
  a file to preview it in bb's file panel, or open it in your editor from the
  row menu.
- **Progress**: where this thread stands — one line with the current stage
  and how many are done; open it for a one-line summary and the full rail of
  stages (done, in progress, dropped, each with its outcome). Read from the
  recap the `worktree-lineage` plugin writes when a turn ends; this plugin
  never triggers a model call. Hidden when that plugin is not installed.
- **Context**: usage and a segmented bar; open it for the provider's own
  breakdown (messages, memory files, skills, system and MCP tools, free
  space, the auto-compact buffer, and tools loaded on demand). Categories
  expand to each memory file, skill or MCP tool, and memory files open in the
  preview. A hint appears at 80%, and a two-step **Compact** sits at the
  bottom.
- **Usage**: plan-limit windows with usage and reset countdowns, the prompt
  cache (in use, warm with a countdown, or cold) with a hint before a large
  context goes cold, agent working time, cost when the provider reports it,
  and token details.
- **Servers**: listeners inside the thread's workspace, including ports
  published by the workspace's docker compose containers. This thread's
  servers come first; agent sessions' own ports and servers other threads
  started fold away, marked "Other thread". Click a row to open it; its menu
  copies the URL or stops servers an agent, a bb terminal or compose started,
  with a confirm step. Name ports in `.bb/ports.json`.
- **Scripts**: saved commands per project. Click to run one in a thread
  terminal; give it a preview URL and it opens a couple of seconds after the
  script starts.
- **Connectors**: the MCP servers the session loaded.
- **Side chats**: the thread's side chats, opened in a split and renamed from
  the row menu.
- **Phones and narrow panes**: bb hides the card there, so a cache and plan
  summary above the composer opens the same sections below it.
- **Interface polish**, applied to bb itself in every theme: the card slides
  in and the transcript makes room smoothly; buttons and rows use the arrow
  cursor while links keep the hand and message text keeps the text cursor.
  Built-in checks warn you when a bb update breaks one, with a fix prompt to
  hand to an agent.
- **Choose details** in the plugin settings picks the sections.
- `bb session-cockpit summary` and `bb session-cockpit servers` for agents.

## How it works

Everything comes from data bb already records: the provider's context and
token-usage events, its rate-limit windows, and bb's provider usage service.
Server discovery runs `lsof` (and `docker ps` when docker is running) on the
thread's machine and keeps only listeners whose working directory, or compose
project, is inside the workspace. Context files are found read-only with
`git ls-files` and `git status` (so ignored folders stay out). Nothing leaves
your machines.

The sections live in bb's thread context card, currently an experiment:
turn it on with `bb settings experiment threadContextCard true`. Claude Code
reports the full context breakdown and cache lifetime; other providers report
totals. Server discovery needs macOS or Linux.
