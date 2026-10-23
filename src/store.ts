import * as vscode from "vscode";
import { Schedule } from "./types";

const SECTION = "kiroCron";
const KEY_SCHEDULES = "schedules";
const KEY_ENABLED = "enabled";

/** Generates a short unique id without external deps. */
export function generateId(): string {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
  );
}

/** True when a workspace/project folder is open. */
export function hasWorkspace(): boolean {
  return !!vscode.workspace.workspaceFolders?.length;
}

/**
 * The config target where schedules and the enabled flag live. Schedules are
 * per-project: when a folder is open they persist in the workspace scope
 * (`.vscode/settings.json`), so each project has its own set. With no folder
 * open we fall back to the global (user) scope.
 */
function writeTarget(): vscode.ConfigurationTarget {
  return hasWorkspace()
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

/**
 * Reads schedules scoped to the active project. When a workspace is open we
 * deliberately read the workspace+folder value (ignoring the global user
 * value) so schedules are strictly per-project. With no folder open we read
 * the global value.
 */
export function getSchedules(): Schedule[] {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  const inspected = cfg.inspect<Schedule[]>(KEY_SCHEDULES);
  let raw: Schedule[] | undefined;
  if (hasWorkspace()) {
    raw =
      inspected?.workspaceFolderValue ??
      inspected?.workspaceValue ??
      [];
  } else {
    raw = inspected?.globalValue ?? [];
  }
  // Normalize: ensure id and enabled default.
  return (raw ?? []).map((s) => ({
    enabled: true,
    ...s,
    id: s.id || generateId(),
  }));
}

/**
 * Master on/off gate for the scheduler. Per-project when a folder is open.
 * Defaults to false so scheduling never runs unless explicitly enabled.
 */
export function isEnabled(): boolean {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  const inspected = cfg.inspect<boolean>(KEY_ENABLED);
  if (hasWorkspace()) {
    return (
      inspected?.workspaceFolderValue ??
      inspected?.workspaceValue ??
      false
    );
  }
  return inspected?.globalValue ?? false;
}

export async function setEnabled(enabled: boolean): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  await cfg.update(KEY_ENABLED, enabled, writeTarget());
}

export function getTimezone(): string | undefined {
  const tz = vscode.workspace
    .getConfiguration(SECTION)
    .get<string>("timezone", "");
  return tz && tz.trim().length > 0 ? tz.trim() : undefined;
}

export function getCatchUpMissedRuns(): boolean {
  return vscode.workspace
    .getConfiguration(SECTION)
    .get<boolean>("catchUpMissedRuns", false);
}

/** Whether a scheduled run should be revealed/kept open in the sidebar. */
export function getRevealSession(): boolean {
  return vscode.workspace
    .getConfiguration(SECTION)
    .get<boolean>("revealSession", true);
}

/**
 * Persists schedules to the per-project (workspace) target when a folder is
 * open, otherwise to the global (user) target.
 */
async function saveSchedules(schedules: Schedule[]): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  await cfg.update(KEY_SCHEDULES, schedules, writeTarget());
}

export async function addSchedule(schedule: Schedule): Promise<void> {
  const all = getSchedules();
  all.push(schedule);
  await saveSchedules(all);
}

export async function updateSchedule(
  id: string,
  patch: Partial<Schedule>
): Promise<void> {
  const all = getSchedules();
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...patch, id };
  await saveSchedules(all);
}

export async function deleteSchedule(id: string): Promise<void> {
  const all = getSchedules().filter((s) => s.id !== id);
  await saveSchedules(all);
}

export function onDidChangeSchedules(
  listener: () => void
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      e.affectsConfiguration(`${SECTION}.schedules`) ||
      e.affectsConfiguration(`${SECTION}.enabled`) ||
      e.affectsConfiguration(`${SECTION}.timezone`) ||
      e.affectsConfiguration(`${SECTION}.catchUpMissedRuns`)
    ) {
      listener();
    }
  });
}
