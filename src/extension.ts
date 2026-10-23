import * as vscode from "vscode";
import { Schedule } from "./types";
import { Scheduler } from "./scheduler";
import { SchedulesProvider, ScheduleItem } from "./treeView";
import * as store from "./store";
import { validateCron, nextRun } from "./cron";
import { isKiroAgentAvailable } from "./kiroAgent";

let scheduler: Scheduler;
let output: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel("Kiro Cron");
  context.subscriptions.push(output);

  output.appendLine(
    `[kiro-cron] activated v${
      context.extension.packageJSON.version
    } @ ${new Date().toISOString()}`
  );
  output.appendLine(
    `[kiro-cron] workspace: ${
      vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath).join(", ") ??
      "(none)"
    }`
  );

  scheduler = new Scheduler(output);
  context.subscriptions.push(scheduler);

  const provider = new SchedulesProvider(scheduler);
  const treeView = vscode.window.createTreeView("kiroCron.schedules", {
    treeDataProvider: provider,
  });
  context.subscriptions.push(treeView);

  const updateViewHeader = () => {
    if (!store.isEnabled()) {
      treeView.message =
        "Scheduler is OFF for this project. Enable it to run schedules.";
    } else if (scheduler.isRunning) {
      treeView.message = undefined;
    } else {
      treeView.message = "Scheduler enabled (starting…).";
    }
  };

  // Keep the view and scheduler in sync with config and runtime changes.
  context.subscriptions.push(
    scheduler.onDidChange(() => {
      provider.refresh();
      updateViewHeader();
    }),
    store.onDidChangeSchedules(() => {
      // Reconcile the timer with the (possibly changed) enabled flag, recompute
      // next-run times, refresh the view, and update the context key.
      scheduler.start();
      scheduler.recomputeAll();
      provider.refresh();
      void syncEnabledContext();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kiroCron.refresh", () => {
      scheduler.recomputeAll();
      provider.refresh();
    }),
    vscode.commands.registerCommand("kiroCron.addSchedule", () =>
      addOrEditSchedule()
    ),
    vscode.commands.registerCommand(
      "kiroCron.editSchedule",
      (item?: ScheduleItem) => addOrEditSchedule(item?.schedule)
    ),
    vscode.commands.registerCommand(
      "kiroCron.deleteSchedule",
      (item?: ScheduleItem) => deleteSchedule(item?.schedule)
    ),
    vscode.commands.registerCommand(
      "kiroCron.toggleSchedule",
      (item?: ScheduleItem) => toggleSchedule(item?.schedule)
    ),
    vscode.commands.registerCommand("kiroCron.runNow", (item?: ScheduleItem) =>
      runNow(item?.schedule)
    ),
    vscode.commands.registerCommand("kiroCron.openSettings", () =>
      vscode.commands.executeCommand(
        "workbench.action.openSettingsJson"
      )
    ),
    vscode.commands.registerCommand("kiroCron.diagnose", () =>
      diagnose(context)
    )
  );

  // Register master enable/disable commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("kiroCron.enableScheduler", async () => {
      await store.setEnabled(true);
      vscode.window.showInformationMessage(
        store.hasWorkspace()
          ? "Kiro Cron: scheduler enabled for this project."
          : "Kiro Cron: scheduler enabled."
      );
      // start() reconciles the timer; config listener also reacts.
      scheduler.start();
      await syncEnabledContext();
    }),
    vscode.commands.registerCommand("kiroCron.disableScheduler", async () => {
      await store.setEnabled(false);
      vscode.window.showInformationMessage(
        store.hasWorkspace()
          ? "Kiro Cron: scheduler disabled for this project."
          : "Kiro Cron: scheduler disabled."
      );
      scheduler.start();
      await syncEnabledContext();
    })
  );

  await syncEnabledContext();
  scheduler.start();
  updateViewHeader();

  // Non-blocking availability notice.
  void isKiroAgentAvailable().then((ok) => {
    if (!ok) {
      output.appendLine(
        "[kiro-cron] WARNING: Kiro agent commands not found. Schedules will " +
          "fail until the Kiro agent is available."
      );
    }
  });
}

export function deactivate() {
  scheduler?.dispose();
}

/**
 * Prints a full status report to the Output channel and reveals it. This is
 * the one-stop troubleshooting command.
 */
async function diagnose(context: vscode.ExtensionContext): Promise<void> {
  output.show(true);
  const line = (s: string) => output.appendLine(s);
  line("\n========== Kiro Cron diagnostics ==========");
  line(`time:            ${new Date().toISOString()}`);
  line(`version:         ${context.extension.packageJSON.version}`);
  line(
    `workspace:       ${
      vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath).join(", ") ??
      "(none — schedules use GLOBAL scope)"
    }`
  );
  line(`scheduler on:    ${store.isEnabled()}`);
  line(`timer running:   ${scheduler.isRunning}`);
  line(`timezone:        ${store.getTimezone() ?? "(local)"}`);
  line(`catch-up missed: ${store.getCatchUpMissedRuns()}`);

  const agentOk = await isKiroAgentAvailable();
  line(`kiro agent cmds: ${agentOk ? "available" : "MISSING"}`);
  if (!agentOk) {
    line(
      "  -> kiroAgent.sessions.create / sendPrompt not found. The Kiro agent " +
        "must be present for schedules to run."
    );
  }

  const schedules = store.getSchedules();
  line(`schedules:       ${schedules.length}`);
  if (schedules.length === 0) {
    line("  -> No schedules for this project. Add one from the Kiro Cron view.");
  }
  for (const s of schedules) {
    const err = validateCron(s.cron);
    const rt = scheduler.getRuntime(s.id);
    const next =
      rt?.nextRun !== undefined
        ? new Date(rt.nextRun).toLocaleString()
        : "(none)";
    line(
      `  - "${s.name}" [${s.enabled === false ? "disabled" : "enabled"}] ` +
        `cron="${s.cron}" ${err ? `INVALID: ${err}` : `next=${next}`}` +
        (rt?.lastRun
          ? ` lastRun=${new Date(rt.lastRun).toLocaleString()}`
          : "") +
        (rt?.lastError ? ` lastError=${rt.lastError}` : "")
    );
  }

  // Common-cause summary.
  line("--- likely reason nothing fires ---");
  if (!agentOk) line("  * Kiro agent commands missing.");
  if (!store.isEnabled())
    line("  * Scheduler is OFF (enable it in the Kiro Cron view).");
  if (schedules.length === 0) line("  * No schedules defined.");
  if (
    agentOk &&
    store.isEnabled() &&
    schedules.length > 0 &&
    schedules.every((s) => s.enabled === false)
  )
    line("  * All schedules are individually disabled.");
  line("===========================================\n");
}

/** Mirrors the per-project enabled flag into a context key for menu `when`s. */
async function syncEnabledContext(): Promise<void> {
  await vscode.commands.executeCommand(
    "setContext",
    "kiroCron.enabled",
    store.isEnabled()
  );
}

async function addOrEditSchedule(existing?: Schedule): Promise<void> {
  const name = await vscode.window.showInputBox({
    title: existing ? "Edit Schedule — Name" : "New Schedule — Name",
    prompt: "A name for this scheduled activity",
    value: existing?.name ?? "",
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? null : "Name is required."),
  });
  if (name === undefined) return;

  const cron = await vscode.window.showInputBox({
    title: "Cron Expression",
    prompt: "5-field cron: min hour dom mon dow  (e.g. '0 9 * * 1-5' = 9am weekdays)",
    value: existing?.cron ?? "0 9 * * *",
    ignoreFocusOut: true,
    validateInput: (v) => validateCron(v),
  });
  if (cron === undefined) return;

  const prompt = await vscode.window.showInputBox({
    title: "Prompt",
    prompt: "The prompt sent to the Kiro agent when this schedule fires",
    value: existing?.prompt ?? "",
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? null : "Prompt is required."),
  });
  if (prompt === undefined) return;

  if (existing) {
    await store.updateSchedule(existing.id, { name, cron, prompt });
  } else {
    await store.addSchedule({
      id: store.generateId(),
      name,
      cron,
      prompt,
      enabled: true,
    });
  }

  const preview = nextRun(cron, { tz: store.getTimezone() });
  vscode.window.showInformationMessage(
    `Kiro Cron: "${name}" saved.` +
      (preview ? ` Next run ${preview.toLocaleString()}.` : "")
  );
}

async function deleteSchedule(schedule?: Schedule): Promise<void> {
  if (!schedule) return;
  const yes = await vscode.window.showWarningMessage(
    `Delete schedule "${schedule.name}"?`,
    { modal: true },
    "Delete"
  );
  if (yes === "Delete") {
    await store.deleteSchedule(schedule.id);
  }
}

async function toggleSchedule(schedule?: Schedule): Promise<void> {
  if (!schedule) return;
  const enabled = schedule.enabled === false ? true : false;
  await store.updateSchedule(schedule.id, { enabled });
  vscode.window.showInformationMessage(
    `Kiro Cron: "${schedule.name}" ${enabled ? "enabled" : "disabled"}.`
  );
}

async function runNow(schedule?: Schedule): Promise<void> {
  if (!schedule) return;
  await scheduler.runNow(schedule);
}
