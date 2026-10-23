# Kiro Cron

Schedule Kiro agent prompts to run on a cron timer, directly inside the Kiro IDE.

Kiro Cron adds a scheduler that fires Kiro agent prompts at times you define
with standard cron expressions. When a schedule fires it creates a fresh Kiro
agent session and submits the prompt — the same thing you'd get by typing the
prompt into a new chat and hitting send.

## How it works

Each fire runs the verified Kiro command path:

```
kiroAgent.sessions.create   ->  { sessionId }
kiroAgent.sessions.sendPrompt(sessionId, promptText)
```

`sessions.sendPrompt` maps to the agent's real submit (ACP `session_prompt`),
so the prompt actually executes rather than just being staged in the input box.

The scheduler is **in-process**: a timer runs inside the extension host. It is
fully cross-platform (Windows, macOS, Linux) and needs no OS-level cron or Task
Scheduler. Because it runs in the IDE, **schedules fire only while Kiro is
open.**

## Key behavior

- **Off by default.** The scheduler does nothing until you enable it. Turn it on
  per project from the Kiro Cron view toolbar (play icon) or via the
  `kiroCron.enabled` setting.
- **Per-project schedules.** Schedules and the enabled flag are stored in the
  workspace (`.vscode/settings.json`), so every project has its own set and
  decides independently whether scheduling runs.
- **Manual run any time.** "Run Now" on a schedule fires immediately regardless
  of the master switch — it's an explicit action.

## Using it

1. Open the **Kiro Cron** view (clock icon in the activity bar).
2. Click **Add Schedule** and provide a name, a 5-field cron expression, and the
   prompt to run.
3. Click **Enable Scheduler** (play icon in the view toolbar) to start firing
   for this project.

### Cron format

Standard 5 fields: `minute hour day-of-month month day-of-week`.

| Expression      | Meaning                        |
| --------------- | ------------------------------ |
| `*/15 * * * *`  | every 15 minutes               |
| `0 9 * * 1-5`   | 9:00am on weekdays             |
| `0 */2 * * *`   | every 2 hours                  |
| `30 8 1 * *`    | 8:30am on the 1st of the month |

## Settings

| Setting                     | Default | Scope    | Description                                                                 |
| --------------------------- | ------- | -------- | --------------------------------------------------------------------------- |
| `kiroCron.enabled`          | `false` | resource | Master switch, per project. No schedules fire unless this is on.            |
| `kiroCron.schedules`        | `[]`    | resource | The list of schedules for this project.                                     |
| `kiroCron.timezone`         | `""`    | resource | IANA timezone for cron evaluation (e.g. `America/New_York`). Empty = local. |
| `kiroCron.catchUpMissedRuns`| `false` | resource | Run a schedule once on startup if its fire time passed while Kiro was closed.|

## Limitations

- Schedules fire only while the Kiro IDE is open. For execution when the IDE is
  closed you would need OS-level scheduling (Windows Task Scheduler, launchd, or
  cron) driving the Kiro CLI in headless mode — a separate setup, not covered by
  this extension.

## License

MIT
