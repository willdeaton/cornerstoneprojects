/*
 * The status board's look, in one place.
 *
 * A TV is read from ten feet away in a lit office, so the board inverts the
 * app: dark ground, few colours, and type that scales with the screen rather
 * than sitting at a fixed size. Every size here is a `clamp()` against the
 * viewport width, so the same page is legible on a 1080p panel in the corner
 * and on a 4K one across the room without a second layout.
 *
 * Colour means exactly what it means everywhere else in the app — amber is work
 * in progress, green is done, grey is not started — so nobody has to learn the
 * board separately from the Schedule it mirrors.
 */

import type { ProjectStatus, TaskStatus } from '@/lib/types';

/** Type scale. Names say what they're for, not how big they are. */
export const TEXT = {
  eyebrow: 'text-[clamp(0.6rem,0.62vw,1rem)] font-semibold uppercase tracking-[0.16em]',
  micro: 'text-[clamp(0.68rem,0.72vw,1.1rem)]',
  small: 'text-[clamp(0.78rem,0.86vw,1.3rem)]',
  body: 'text-[clamp(0.9rem,1vw,1.55rem)]',
  name: 'text-[clamp(1.05rem,1.3vw,2rem)]',
  heading: 'text-[clamp(1.2rem,1.55vw,2.4rem)]',
  stat: 'text-[clamp(1.6rem,2.3vw,3.6rem)]',
  clock: 'text-[clamp(1.5rem,2.1vw,3.2rem)]',
} as const;

/** Panels on the dark ground: a hairline and a barely-there fill, never a shadow. */
export const CARD = 'rounded-2xl border border-white/10 bg-white/[0.04]';

/** The board's ground colour, dark enough that a lit room doesn't wash it out. */
export const BOARD_BG = '#0E120F';

/** A phase's bar and chip colour — the Schedule's own status palette, on dark. */
export const PHASE_TINT: Record<TaskStatus, string> = {
  not_started: 'bg-white/30 text-white',
  in_progress: 'bg-status-progress text-brand-ink',
  complete: 'bg-brand-green text-brand-ink',
};

/** The same three states as a quiet label rather than a filled bar. */
export const PHASE_BADGE: Record<TaskStatus, string> = {
  not_started: 'bg-white/10 text-white/70',
  in_progress: 'bg-status-progress/25 text-status-progress',
  complete: 'bg-brand-green/20 text-brand-green',
};

/** A job's status as the dot beside its name on the timeline. */
export const JOB_DOT: Record<ProjectStatus, string> = {
  not_started: 'bg-white/35',
  in_progress: 'bg-status-progress',
  completed: 'bg-brand-green',
};
