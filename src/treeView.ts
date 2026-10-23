import * as vscode from "vscode";
import { Schedule } from "./types";
import { Scheduler } from "./scheduler";
import * as store from "./store";
import { validateCron } from "./cron";

export class ScheduleItem extends vscode.TreeItem {
  constructor(public readonly schedule: Schedule, scheduler: Scheduler) {
    super(schedule.name || "(unnamed)", vscode.TreeItemCollapsibleState.None);
    this.contextValue = "schedule";
    this.id = schedule.id;

    const enabled = schedule.enabled !== false;
    const rt = scheduler.getRuntime(schedule.id);
    const cronError = validateCron(schedule.cron);

    if (cronError) {
      this.iconPath = new vscode.ThemeIcon(
        "error",
        new vscode.ThemeColor("errorForeground")
      );
    } else if (!enabled) {
      this.iconPath = new vscode.ThemeIcon("circle-outline");
    } else if (rt?.lastError) {
      this.iconPath = new vscode.ThemeIcon(
        "warning",
        new vscode.ThemeColor("editorWarning.foreground")
      );
    } else {
      this.iconPath = new vscode.ThemeIcon("clock");
    }

    const parts: string[] = [schedule.cron];
    if (cronError) {
      parts.push("invalid cron");
    } else if (!enabled) {
      parts.push("disabled");
    } else if (rt?.nextRun) {
      parts.push("next " + formatRelative(rt.nextRun));
    }
    this.description = parts.join("  •  ");

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${escapeMd(schedule.name)}**\n\n`);
    md.appendMarkdown(`- Cron: \`${escapeMd(schedule.cron)}\`\n`);
    md.appendMarkdown(`- Enabled: ${enabled ? "yes" : "no"}\n`);
    if (cronError) md.appendMarkdown(`- ⚠️ ${escapeMd(cronError)}\n`);
    if (rt?.nextRun)
      md.appendMarkdown(`- Next run: ${new Date(rt.nextRun).toLocaleString()}\n`);
    if (rt?.lastRun)
      md.appendMarkdown(`- Last run: ${new Date(rt.lastRun).toLocaleString()}\n`);
    if (rt?.lastError) md.appendMarkdown(`- Last error: ${escapeMd(rt.lastError)}\n`);
    md.appendMarkdown(`\n---\n\n${escapeMd(truncate(schedule.prompt, 300))}`);
    this.tooltip = md;

    this.command = {
      command: "kiroCron.editSchedule",
      title: "Edit Schedule",
      arguments: [this],
    };
  }
}

export class SchedulesProvider
  implements vscode.TreeDataProvider<ScheduleItem>
{
  private readonly emitter = new vscode.EventEmitter<
    ScheduleItem | undefined | void
  >();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly scheduler: Scheduler) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: ScheduleItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ScheduleItem[] {
    return store
      .getSchedules()
      .map((s) => new ScheduleItem(s, this.scheduler));
  }
}

function formatRelative(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return "now";
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `in ${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `in ${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `in ${hr}h`;
  const day = Math.round(hr / 24);
  return `in ${day}d`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function escapeMd(s: string): string {
  return (s ?? "").replace(/[\\`*_{}\[\]()#+\-.!]/g, (m) => "\\" + m);
}
