import 'server-only';
import type { Client } from 'pg';
import { createListenerClient, getDb } from './db';

/*
 * ============================================================================
 *  LIVE SCHEDULE
 *
 *  A schedule change has to reach the people it is about, not just the person
 *  who made it. Saving writes to Postgres and refreshes the editor's own page;
 *  everybody else was left holding whatever the board looked like when their
 *  page loaded — which, on a phone left open in a truck, can be yesterday.
 *
 *  So the database announces its own changes. Every write that touches the
 *  schedule ends with a `pg_notify` on one channel; each server process holds
 *  a single connection LISTENing on it and fans what arrives out to the
 *  browsers connected to /api/schedule/stream, which tells them to re-read.
 *
 *  Postgres carries the announcement rather than an in-process event emitter
 *  for one reason: it works when there is more than one server. Two instances
 *  behind a load balancer see each other's writes, because the announcement
 *  comes from the thing they share.
 *
 *  Announcing is best-effort by design. A notify that fails is swallowed: the
 *  write has already happened, and the cost of losing the announcement is a
 *  board that refreshes on its backstop poll instead of instantly. It is never
 *  worth failing somebody's save over.
 * ============================================================================
 */

/** The channel every schedule change is announced on. */
const CHANNEL = 'cs_schedule';

/**
 * How long announcements are gathered up before going out. One save flushes a
 * queue of edits through the actions one at a time, and each announces itself;
 * without this a ten-edit save would tell every browser to re-read ten times.
 */
const COALESCE_MS = 250;

/** How long to wait before rebuilding a listening connection that dropped. */
const RETRY_MS = 2_000;
const MAX_RETRY_MS = 30_000;

/** What a browser is told when the schedule moves. */
export interface ScheduleEvent {
  /** When the change landed, as epoch milliseconds. */
  at: number;
  /** The job it touched, or null for a change that spans jobs. */
  projectId: number | null;
}

type Listener = (event: ScheduleEvent) => void;

interface Hub {
  listeners: Set<Listener>;
  client: Client | null;
  connecting: Promise<void> | null;
  retryMs: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  pending: ScheduleEvent | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

// Per process, and pinned to globalThis so dev's hot reload doesn't leave a
// second listening connection behind on every edit — the same reason the pool
// itself lives there.
const g = globalThis as unknown as { __csLiveHub?: Hub };

function hub(): Hub {
  if (!g.__csLiveHub) {
    g.__csLiveHub = {
      listeners: new Set(),
      client: null,
      connecting: null,
      retryMs: RETRY_MS,
      retryTimer: null,
      pending: null,
      flushTimer: null,
    };
  }
  return g.__csLiveHub;
}

/* ------------------------------------------------------------- Announcing */

/**
 * Tell every connected browser that the schedule moved.
 *
 * Called after the write, never before: a browser that re-reads on the back of
 * this has to find the change already there.
 */
export async function announceScheduleChange(projectId?: number | null): Promise<void> {
  try {
    const db = await getDb();
    const payload: ScheduleEvent = { at: Date.now(), projectId: projectId ?? null };
    await db.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(payload)]);
  } catch {
    // Best-effort: the save stands, and the backstop poll picks the change up.
  }
}

/* -------------------------------------------------------------- Listening */

/**
 * Hear about schedule changes for as long as the returned function isn't
 * called. The first subscriber opens the listening connection; it is then kept
 * open, because in an office where the wall board and half a dozen phones are
 * on the schedule all day, closing it on the last unsubscribe would mean
 * rebuilding it seconds later.
 */
export function subscribeToScheduleChanges(fn: Listener): () => void {
  const h = hub();
  h.listeners.add(fn);
  void connect(h);
  return () => {
    h.listeners.delete(fn);
  };
}

function connect(h: Hub): Promise<void> {
  if (h.client || h.connecting) return h.connecting ?? Promise.resolve();

  h.connecting = (async () => {
    const client = createListenerClient();
    // Both of these mean the same thing — the connection is gone and nothing
    // is being heard through it any more — so both rebuild it. `drop` is
    // guarded against being run twice for the same client.
    client.on('error', () => drop(h, client));
    client.on('end', () => drop(h, client));
    client.on('notification', (msg) => {
      if (msg.channel !== CHANNEL) return;
      queue(h, parse(msg.payload));
    });
    await client.connect();
    // CHANNEL is a constant in this file, never anything a request supplied,
    // which is what makes interpolating it here safe: LISTEN takes an
    // identifier, and identifiers can't be parameterised.
    await client.query(`LISTEN ${CHANNEL}`);
    h.client = client;
    h.retryMs = RETRY_MS;
  })()
    .catch(() => {
      retryLater(h);
    })
    .finally(() => {
      h.connecting = null;
    });

  return h.connecting;
}

/** A dead connection: forget it and build another, backing off as it fails. */
function drop(h: Hub, client: Client) {
  if (h.client !== client && h.client !== null) return;
  h.client = null;
  void client.end().catch(() => {});
  retryLater(h);
}

function retryLater(h: Hub) {
  if (h.retryTimer || h.listeners.size === 0) return;
  const wait = h.retryMs;
  h.retryMs = Math.min(h.retryMs * 2, MAX_RETRY_MS);
  h.retryTimer = setTimeout(() => {
    h.retryTimer = null;
    void connect(h);
  }, wait);
  // A retry timer must never be the thing keeping the process alive.
  h.retryTimer.unref?.();
}

/** Hold an announcement briefly, so a burst of writes lands as one event. */
function queue(h: Hub, event: ScheduleEvent) {
  h.pending = event;
  if (h.flushTimer) return;
  h.flushTimer = setTimeout(() => {
    h.flushTimer = null;
    const out = h.pending;
    h.pending = null;
    if (!out) return;
    for (const fn of [...h.listeners]) {
      try {
        fn(out);
      } catch {
        // One browser's stream failing can't stop the others being told.
      }
    }
  }, COALESCE_MS);
  h.flushTimer.unref?.();
}

function parse(payload: string | undefined): ScheduleEvent {
  try {
    const raw = JSON.parse(payload ?? '{}') as Partial<ScheduleEvent>;
    return {
      at: typeof raw.at === 'number' ? raw.at : Date.now(),
      projectId: typeof raw.projectId === 'number' ? raw.projectId : null,
    };
  } catch {
    return { at: Date.now(), projectId: null };
  }
}
