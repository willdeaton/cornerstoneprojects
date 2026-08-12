/**
 * Shared rule for the mandatory clock-out shift synopsis. Lives in its own
 * file (no 'server-only') so the client time clock, the server action and the
 * data layer all enforce exactly the same rule with the same message.
 */

export const SYNOPSIS_ERROR = 'Please add a brief synopsis of your shift before clocking out.';

/** A synopsis counts when it has at least 5 non-whitespace characters. */
export function isValidSynopsis(note: string | null | undefined): boolean {
  return (note ?? '').replace(/\s/g, '').length >= 5;
}
