# Routines for PlaneAI

A PlaneAI plugin that creates tasks on a schedule.
A routine names a project, a schedule and a task template, such as a retro every Friday at 09:00 or an invoice reminder on the first of the month.

Open **Routines** from the **Routines** button at the top of PlaneAI's sidebar, under **New session** and **New project**, or from Cmd+K, to manage them.
The button shows when the next enabled routine runs: `09:00` for today, `Mon 09:00` within the week, `Oct 20 09:00` further out, and nothing when no routine is enabled.
It refreshes every 30 seconds, and in a sidebar narrower than 220px it shows only its icon, like the buttons beside it.
Each routine has a name, an on/off switch, a project, a schedule, the task's title, description, priority and tags, and whether PlaneAI starts a session on the task.
The list shows when each routine runs next, whether it starts a session, the last task it created, and any error, and **Run now** creates a task immediately.

## Requirements

- A PlaneAI build whose plugin host offers `host.tasks.create` for top-level tasks, with its `start` option, and the `sessions.start` capability.
  A PlaneAI that does not know `sessions.start` refuses to install the plugin.

The plugin asks for the `settings`, `projects.read`, `tasks.create` and `sessions.start` capabilities.

## Behavior

- **Schedules.** Every day, weekdays, specific days of the week, a day of the month, or a standard 5-field cron expression, all at a local `HH:MM`.
  A monthly routine on day 29, 30 or 31 skips the months without that day.
- **Time zone.** Schedules run in the time zone of the machine PlaneAI runs on, through [croner](https://github.com/Hexagon/croner).
- **Placeholders.** The title and description may use `{{date}}` (2026-10-06), `{{time}}` (09:00), `{{weekday}}` (Tuesday), `{{week}}` (ISO week number), `{{month}}` (October), `{{year}}` (2026) and `{{routine}}` (the routine's name).
  They are filled in from the time the task was due, not the time it was created, and unknown placeholders are left as written.
- **Priority.** None, Low, Medium or High, PlaneAI's own levels, where a higher level is more urgent.
- **Sessions.** Like **Start session immediately** in PlaneAI's task form, which is also the default here, a routine can have PlaneAI start a session on each task it creates.
  It picks the provider (PlaneAI's default unless one is chosen), whether the session gets a worktree, and auto-approve, which is off for providers that do not support it.
  The branch, session name and prompt follow PlaneAI's task templates, and the task moves to In Progress.
  Routines saved before this option existed start a session too.
  PlaneAI starts the session in the background, at most once per task, and reports a failed start itself; the routine only shows an error when PlaneAI refuses the request outright.
  With PlaneAI's `local` session backend, the agent only starts when its terminal is opened, so a routine's session waits until you open it.
- **Checking.** PlaneAI calls the plugin every 30 seconds while it is enabled, and right after the routines are saved.
  Set `tick_interval_ms` in the plugin's settings to change the interval.
- **Catch-up.** Runs missed while PlaneAI was closed collapse into one task for the most recent one, as long as it is within 400 days.
- **No surprise tasks.** A new, re-enabled or rescheduled routine starts counting from that moment, so it never creates a task for a time that already passed.
- **Idempotency.** Each task is created with an operation id made of the routine and its due time, and PlaneAI creates at most one task per operation id.
  A crash or a failed attempt retries the same operation, so it never creates a duplicate.
  **Run now** uses its own operation id and does not move the schedule.
- **Errors.** A failed creation, such as a project that was removed or hidden, is shown on the routine and retried on the next check.
  A routine whose settings are malformed shows why and never stops the others.

The routines live in PlaneAI's settings for the plugin.
What the plugin remembers between checks (when each routine last ran, its last task and error) is a separate `routines-state.json` file in the plugin's data directory, written only by the plugin.

## Install

Download the archive for your platform from the repository's Releases page, extract it, then in PlaneAI open **Preferences → Plugins → Install local package** and select the extracted `planeai-plugin-routines` directory.
Enable it, then open **Routines** from the sidebar button or Cmd+K.

To update, install the new package the same way, over the installed one.
Do not remove the plugin first: removing it deletes its settings, including every routine.

## Develop

Prerequisites: Node 22+, pnpm 10, and Bun 1.4.

```bash
pnpm install
make test            # tsc, svelte-check, vitest
make package         # stage dist/planeai-plugin-routines for this platform
make verify-package  # handshake check against the staged binary
make smoke           # play PlaneAI against the staged binary: one due routine creates one task
make conformance PLANEAI_CLI=/path/to/planeai-cli  # PlaneAI's offline plugin contract checks
```

Install the staged `dist/planeai-plugin-routines` directory into a PlaneAI dev build to try it.
Tests run in the `America/Toronto` time zone, set in `vite.config.ts`, so their expected times hold on any machine.

### Layout

| Path | Role |
| --- | --- |
| `src/main.ts` | Sidecar entrypoint: JSON-RPC over stdio and the PlaneAI callbacks. |
| `src/rpc.ts` | Newline-framed JSON-RPC 2.0 peer with `$/cancelRequest`, requests to the host, and the 64 KiB frame limit. |
| `src/routines.ts` | The plugin: `routines.tick`, `routines.status` and `routines.runNow`. |
| `src/routine.ts` | The routine types and the parser for the settings document, with one problem per malformed routine. |
| `src/schedule.ts` | Schedules compiled to cron, their descriptions, next runs and latest due occurrence. |
| `src/template.ts` | Placeholders for task titles and descriptions. |
| `src/state.ts` | The sidecar's run state file, replaced atomically. |
| `ui/` | The Svelte 5 main pane and sidebar button, each built into one self-contained ESM bundle, `ui/routines.js` and `ui/sidebar.js`. |
| `scripts/smoke.mjs` | Plays PlaneAI over stdin and stdout against the staged binary. |

## Release

Conventional commits on `main` drive `auto` versioning.
The release workflow cross-compiles the sidecar with Bun for `macos-arm64`, `linux-x64` and `windows-x64`, and publishes one archive per platform, each declaring only its own entrypoint.
