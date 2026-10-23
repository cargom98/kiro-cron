import { CronExpressionParser } from "cron-parser";

export interface CronOptions {
  /** IANA timezone, e.g. "America/New_York". Undefined = system local. */
  tz?: string;
  /** Reference "current" time; defaults to now. */
  currentDate?: Date;
}

/** Validates a 5-field cron expression. Returns an error string or null. */
export function validateCron(expr: string): string | null {
  const trimmed = (expr ?? "").trim();
  if (!trimmed) return "Cron expression is empty.";
  // We require the standard 5 fields (min hour dom mon dow).
  const fieldCount = trimmed.split(/\s+/).length;
  if (fieldCount !== 5) {
    return `Expected 5 fields (min hour dom mon dow), got ${fieldCount}.`;
  }
  try {
    CronExpressionParser.parse(trimmed);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/**
 * Returns the next fire time strictly after `options.currentDate` (default
 * now), or null if the expression is invalid.
 */
export function nextRun(expr: string, options: CronOptions = {}): Date | null {
  try {
    const interval = CronExpressionParser.parse(expr.trim(), {
      currentDate: options.currentDate ?? new Date(),
      tz: options.tz,
    });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

/**
 * Returns the most recent fire time at or before `at`, or null. Used for
 * optional catch-up of runs missed while the IDE was closed.
 */
export function prevRun(
  expr: string,
  at: Date,
  options: CronOptions = {}
): Date | null {
  try {
    const interval = CronExpressionParser.parse(expr.trim(), {
      currentDate: at,
      tz: options.tz,
    });
    return interval.prev().toDate();
  } catch {
    return null;
  }
}
