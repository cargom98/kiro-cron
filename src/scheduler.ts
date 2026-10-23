import * as vscode from "vscode";
import { Schedule, ScheduleRuntime } from "./types";
import { nextRun, prevRun } from "./cron";
import * as store from "./store";
import {
  runPrompt,
  isKiroAgentAvailable,
  revealSession,
  DEFAULT_SESSION_TITLE,
} from "./kiroAgent";

/**
 * In-process cron scheduler. Runs entirely inside the VS Code extension host
 * using setTimeout, so it is fully cross-platform (Windows, macOS, Linux) and
 * requires no OS-level cron/Task Scheduler. Schedules fire only while the IDE
 * is open.
 *
 * Design: a single wall-clock "tick" every TICK_MS re-evaluates all enabled
 * schedules and fires any whose next-run time has passed since the last tick.
 * A polling tick (rather than one timer per schedule) is robust against
 * system sleep/wake and clock changes, and avoids 32-bit setTimeout overflow
 * for far-future schedules.
 */

const TICK_MS = 15_000;
/** Guard so a single missed fire window never triggers a flood. */
const MAX_BACKLOG_MS = TICK_MS * 4;

export class Scheduler implements vscode.Disposable {
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTick = Date.now();
  private readonly runtime = new Map<string, ScheduleRuntime>();
  private readonly running = new Set<string>();
  private readonly onChangeEmitter = new vscode.EventEmitter<void>();

  /** Fires whenever runtime state (next/last run, errors) changes. */
  readonly onDidChange = this.onChangeEmitter.event;

  constructor(private readonly output: vscode.OutputChannel) {}

  /**
   * Starts (or restarts) the polling timer, but only when the scheduler is
   * enabled for the active project. Safe to call repeatedly; it reconciles the
   * timer with the current `kiroCron.enabled` state.
   */
  start(): void {
    this.recomputeAll();

    if (!store.isEnabled()) {
      // Disabled: ensure no timer is running and fire nothing.
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
      this.output.appendLine(
        "[scheduler] disabled for this project (kiroCron.enabled = false). " +
          "No schedules will fire. Enable it from the Kiro Cron view."
      );
      this.onChangeEmitter.fire();
      return;
    }

    if (this.timer) return; // already running

    this.maybeCatchUp();
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.output.appendLine(
      `[scheduler] enabled & started (tick ${TICK_MS}ms, tz=${
        store.getTimezone() ?? "local"
      })`
    );
    this.onChangeEmitter.fire();
  }

  /** True when the polling timer is actively running. */
  get isRunning(): boolean {
    return this.timer !== undefined;
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.onChangeEmitter.dispose();
  }

  getRuntime(id: string): ScheduleRuntime | undefined {
    return this.runtime.get(id);
  }

  /** Recomputes next-run times for all schedules (call after config change). */
  recomputeAll(): void {
    const tz = store.getTimezone();
    const schedules = store.getSchedules();
    const seen = new Set<string>();
    for (const s of schedules) {
      seen.add(s.id);
      const rt = this.runtime.get(s.id) ?? {};
      if (s.enabled === false) {
        rt.nextRun = undefined;
      } else {
        const next = nextRun(s.cron, { tz });
        rt.nextRun = next ? next.getTime() : undefined;
      }
      this.runtime.set(s.id, rt);
    }
    // Drop runtime for deleted schedules.
    for (const id of [...this.runtime.keys()]) {
      if (!seen.has(id)) this.runtime.delete(id);
    }
    this.onChangeEmitter.fire();
  }

  private tick(): void {
    // Defensive: if the project disabled scheduling, stop firing immediately.
    if (!store.isEnabled()) {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
      this.onChangeEmitter.fire();
      return;
    }

    const now = Date.now();
    const from = this.lastTick;
    this.lastTick = now;

    const tz = store.getTimezone();
    for (const s of store.getSchedules()) {
      if (s.enabled === false) continue;
      const rt = this.runtime.get(s.id) ?? {};
      const due = rt.nextRun;
      if (due !== undefined && due <= now && due > from - MAX_BACKLOG_MS) {
        void this.fire(s, "schedule");
      }
      // Always refresh the next-run pointer.
      const next = nextRun(s.cron, { tz, currentDate: new Date(now) });
      rt.nextRun = next ? next.getTime() : undefined;
      this.runtime.set(s.id, rt);
    }
    this.onChangeEmitter.fire();
  }

  /** Fire a schedule now, on demand (e.g. from the "Run Now" command). */
  async runNow(schedule: Schedule): Promise<void> {
    await this.fire(schedule, "manual");
  }

  private async fire(schedule: Schedule, reason: "schedule" | "manual"): Promise<void> {
    if (this.running.has(schedule.id)) {
      this.output.appendLine(
        `[scheduler] skip "${schedule.name}" — previous run still in progress`
      );
      return;
    }
    this.running.add(schedule.id);
    const rt = this.runtime.get(schedule.id) ?? {};
    try {
      if (!(await isKiroAgentAvailable())) {
        throw new Error(
          "Kiro agent commands unavailable (kiroAgent.sessions.create / sendPrompt)."
        );
      }
      this.output.appendLine(
        `[scheduler] firing (${reason}) "${schedule.name}" @ ${new Date().toISOString()}`
      );
      // Reuse the schedule's existing session when we have one; runPrompt
      // self-heals by creating a fresh session if the old one is stale.
      const run = await runPrompt(schedule.prompt, rt.sessionId);
      rt.sessionId = run.sessionId;
      rt.lastRun = Date.now();
      rt.lastError = undefined;
      this.output.appendLine(
        `[scheduler] "${schedule.name}" -> session ${run.sessionId} (${
          run.created ? "created new" : "reused"
        })`
      );

      // Optionally reveal the session (keep it open + titled) instead of
      // leaving it only in history. Only meaningful when a new session was
      // created, or when the user wants it re-focused each run.
      if (store.getRevealSession()) {
        const title = schedule.sessionTitle?.trim() || DEFAULT_SESSION_TITLE;
        await revealSession(run.sessionId, title);
      }
    } catch (err) {
      rt.lastError = (err as Error).message;
      this.output.appendLine(
        `[scheduler] ERROR firing "${schedule.name}": ${rt.lastError}`
      );
      vscode.window.showErrorMessage(
        `Kiro Cron: "${schedule.name}" failed — ${rt.lastError}`
      );
    } finally {
      this.running.delete(schedule.id);
      this.runtime.set(schedule.id, rt);
      this.onChangeEmitter.fire();
    }
  }

  /**
   * Optionally run schedules whose fire time passed while the IDE was closed.
   * Enabled via `kiroCron.catchUpMissedRuns`. Fires at most once per schedule.
   */
  private maybeCatchUp(): void {
    if (!store.getCatchUpMissedRuns()) return;
    const tz = store.getTimezone();
    const now = new Date();
    for (const s of store.getSchedules()) {
      if (s.enabled === false) continue;
      const prev = prevRun(s.cron, now, { tz });
      const rt = this.runtime.get(s.id) ?? {};
      // Only catch up if the previous scheduled time is recent-ish and we have
      // no record of having run it after that time.
      if (prev && (!rt.lastRun || rt.lastRun < prev.getTime())) {
        this.output.appendLine(
          `[scheduler] catch-up firing "${s.name}" (missed ${prev.toISOString()})`
        );
        void this.fire(s, "manual");
      }
    }
  }
}
