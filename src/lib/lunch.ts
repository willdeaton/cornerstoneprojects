/**
 * Shared rules for the lunch break a worker reports when clocking out. Lives
 * in its own file (no 'server-only') so the clock-out prompt, the server
 * action and the data layer all offer and accept exactly the same lengths.
 */

/** The lunch lengths offered at clock-out, in the order they're shown. */
export const LUNCH_OPTIONS = [
  { minutes: 30, label: '30 minutes' },
  { minutes: 45, label: '45 minutes' },
  { minutes: 60, label: '1 hour' },
] as const;

/** Just the minute values, for validation. */
export const LUNCH_MINUTES: number[] = LUNCH_OPTIONS.map((o) => o.minutes);

export const LUNCH_ERROR = 'Pick a lunch break of 30 minutes, 45 minutes or 1 hour.';

/** 0 / nothing means "no lunch"; anything else has to be one of the offered
 *  lengths, so a hand-crafted request can't invent its own deduction. */
export function isValidLunchMinutes(minutes: number | null | undefined): boolean {
  if (minutes === null || minutes === undefined || minutes === 0) return true;
  return LUNCH_MINUTES.includes(minutes);
}
