export interface Schedule {
  /** Unique identifier (uuid-ish). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Standard 5-field cron expression: "min hour dom mon dow". */
  cron: string;
  /** Prompt text sent to the Kiro agent when this schedule fires. */
  prompt: string;
  /** Whether the schedule is active. Defaults to true when omitted. */
  enabled?: boolean;
  /**
   * Optional title for the revealed session. Defaults to "Kiro Cron" when
   * omitted. Only used when `kiroCron.revealSession` is enabled.
   */
  sessionTitle?: string;
}

/** Runtime status tracked per schedule (not persisted to settings). */
export interface ScheduleRuntime {
  /** Timestamp (ms) of the last successful fire, or undefined. */
  lastRun?: number;
  /** Last error message, if the most recent fire failed. */
  lastError?: string;
  /** Computed next fire time (ms), or undefined if the cron is invalid. */
  nextRun?: number;
  /**
   * The agent session this schedule reuses across fires. Set after the first
   * successful run and reused on subsequent runs; cleared/replaced if the
   * session becomes stale. Not persisted (sessions don't survive reloads).
   */
  sessionId?: string;
}
