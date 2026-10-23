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
}

/** Runtime status tracked per schedule (not persisted to settings). */
export interface ScheduleRuntime {
  /** Timestamp (ms) of the last successful fire, or undefined. */
  lastRun?: number;
  /** Last error message, if the most recent fire failed. */
  lastError?: string;
  /** Computed next fire time (ms), or undefined if the cron is invalid. */
  nextRun?: number;
}
