# Routines for PlaneAI

A PlaneAI plugin that creates tasks on a schedule.
A routine names a project, a schedule and a task template, such as a retro every Friday at 09:00 or an invoice reminder on the first of the month.

Open **Routines** from the **Routines** button at the top of PlaneAI's sidebar, under **New session** and **New project**, or from Cmd+K, to manage them in a dialog over your workspace.
Escape closes the routine being edited, then the dialog.
The button shows when the next enabled routine runs: `09:00` for today, `Mon 09:00` within the week, `Oct 20 09:00` further out, and nothing when no routine is enabled.
It refreshes every 30 seconds, and in a sidebar narrower than 220px it shows only its icon, like the buttons beside it.
Each routine has a name, an on/off switch, a project, a schedule, the task's title, description, priority and tags, and whether PlaneAI starts a session on the task.
The list shows when each routine runs next, whether it starts a session, the last task it created, and any error, and **Run now** creates a task immediately.
The dialog re-reads the routines and their run times after each check, and each change is saved over the routines PlaneAI has at that moment, so a change made elsewhere is kept.
A save that fails leaves the editor open with your changes, to save again or cancel.

## Requirements

- A PlaneAI build serving plugin host API `planeai.plugin-host.v4`, which adds top-level `host.tasks.create` with its `start` option, the `sessions.start` capability and the `dialog` UI placement.
  An older PlaneAI refuses to install the plugin with "plugin manifest requires an unsupported host API version".

The plugin asks for the `settings`, `projects.read`, `tasks.create` and `sessions.start` capabilities.

## Behavior

- **Schedules.** Every day, weekdays, specific days of the week, a day of the month, or a standard 5-field cron expression, all at a local `HH:MM`.
  A monthly routine on day 29, 30 or 31 skips the months without that day.
- **Time zone.** Schedules run in the time zone of the machine PlaneAI runs on, through [croner](https://github.com/Hexagon/croner).
- **Placeholders.** The title and description may use `{{date}}` (2026-10-06), `{{time}}` (09:00), `{{weekday}}` (Tuesday), `{{week}}` (ISO week number), `{{month}}` (October), `{{year}}` (2026) and `{{routine}}` (the routine's name).
  They are filled in from the time the task was due, not the time it was created, and unknown placeholders are left as written.
- **Priority.** None, Lowest, Low, Medium, High or Highest, stored as 0 to 5 like PlaneAI's other tasks, where a higher level is more urgent.
- **Sessions.** Like **Start session immediately** in PlaneAI's task form, which is also the default here, a routine can have PlaneAI start a session on each task it creates.
  It picks the provider (PlaneAI's default unless one is chosen), whether the session gets a worktree, and auto-approve, which is off for providers that do not support it.
  The branch, session name and prompt follow PlaneAI's task templates, and the task moves to In Progress.
  Routines saved before this option existed start a session too.
  PlaneAI starts the session in the background, at most once per task, and reports a failed start itself, naming the plugin.
  With PlaneAI's `local` session backend, the agent only starts when its terminal is opened, so a routine's session waits until you open it.
- **Checking.** PlaneAI calls the plugin every 30 seconds while it is enabled, and right after the routines are saved.
  Set `tick_interval_ms` in the plugin's settings to change the interval.
- **Catch-up.** Runs missed while PlaneAI was closed collapse into one task for the most recent one, as long as it is within 400 days.
- **No surprise tasks.** A new, re-enabled or rescheduled routine starts counting from that moment, so it never creates a task for a time that already passed.
- **Idempotency.** Each task is created with an operation id made of the routine and its due time, and PlaneAI creates at most one task per operation id.
  A crash or a failed attempt retries the same operation, so it never creates a duplicate.
  **Run now** does not move the schedule, and gets its own operation id per click: running it again after it failed retries that same click, so a run whose reply was lost still creates one task.
- **Errors.** The last error shows on the routine until its next task is created.
  A failure that may pass on its own is retried on the next check with the same operation id: PlaneAI temporarily unavailable (JSON-RPC `-32004`, such as a provider plugin that is not running yet right after launch), a host error (`-32603`) or a cancelled request.
  A refusal that only a change outside the plugin can fix skips that occurrence, and the routine fires the next one: invalid params (`-32602`, such as a hidden or removed project), a capability PlaneAI did not grant (`-32003`, reinstall the plugin) or a PlaneAI without `host.tasks.create` (`-32601`, update PlaneAI).
  Once the cause is fixed, for example the project unhidden, the next occurrence succeeds; use **Run now** to make up for the skipped one.
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
make lint            # oxlint, and oxfmt --check (make fmt formats)
make test            # tsc, svelte-check, vitest
make package         # stage dist/planeai-plugin-routines for this platform
make verify-package  # handshake check against the staged binary
make smoke           # play PlaneAI against the staged binary: one due routine creates one task
make conformance PLANEAI_CLI=/path/to/planeai-cli  # PlaneAI's offline plugin contract checks
```

Install the staged `dist/planeai-plugin-routines` directory into a PlaneAI dev build to try it.
Tests run in the `America/Toronto` time zone, set in `vite.config.ts`, so their expected times hold on any machine.

### Layout

| Path                | Role                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`       | Sidecar entrypoint: JSON-RPC over stdio.                                                                                     |
| `src/rpc.ts`        | Newline-framed JSON-RPC 2.0 peer with `$/cancelRequest`, requests to the host, and the 64 KiB frame limit.                   |
| `src/host.ts`       | The PlaneAI callbacks the plugin makes, with their replies checked.                                                          |
| `src/routines.ts`   | The plugin: `routines.tick`, `routines.status` and `routines.runNow`.                                                        |
| `src/routine.ts`    | The routine types and the parser for the settings document, with one problem per malformed routine.                          |
| `src/schedule.ts`   | Schedules compiled to cron, their descriptions, next runs and latest due occurrence.                                         |
| `src/template.ts`   | Placeholders for task titles and descriptions.                                                                               |
| `src/state.ts`      | The sidecar's run state file, flushed to disk and replaced atomically.                                                       |
| `ui/`               | The Svelte 5 dialog and sidebar button, each built into one self-contained ESM bundle, `ui/routines.js` and `ui/sidebar.js`. |
| `scripts/smoke.mjs` | Plays PlaneAI over stdin and stdout against the staged binary.                                                               |

## Release

Conventional commits on `main` drive `auto` versioning.
The release workflow builds the sidecar with Bun on a native `macos-arm64`, `linux-x64` and `windows-x64` runner, injects the version into the manifest and the handshake, and runs the tests, `make verify-package` and `make smoke` against each platform's own binary.
Only when every platform passes does it tag the commit and publish one archive per platform, each declaring only its own entrypoint, after approval in the `release` environment.
CI runs the same checks on the three platforms for every pull request.
