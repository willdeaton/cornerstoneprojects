import 'server-only';
import { getDb } from '../db';

/*
 * The outbox behind the two daily digest emails.
 *
 * Selling a quote or completing a job used to send an email on the spot, which
 * meant a busy afternoon filled everyone's inbox. Those moments now QUEUE an
 * event here instead, and the daily digest scheduler drains the queue once a
 * day into one email per kind.
 *
 * Queueing (rather than asking the projects table what changed today) is what
 * keeps the digest exact: projects.updated_at moves on any edit, so it can't
 * distinguish "sold today" from "someone fixed a typo today", and an unsent
 * backlog survives a server that was down when the digest was due.
 */

/** The two digest streams. One email per kind per day. */
export const DIGEST_KINDS = ['new_project', 'job_completed'] as const;
export type DigestKind = (typeof DIGEST_KINDS)[number];

/** One queued job, joined with the project fields the digest lists. */
export interface DigestEvent {
  id: number;
  project_id: number;
  /** When the job was sold / completed — the digest may span more than a day. */
  created_at: string;
  name: string;
  customer: string;
  value: number;
  quote_number: string | null;
  category: string | null;
  status: string;
}

/**
 * Record that something worth reporting happened to a job. Best-effort and
 * never throws: the business action (converting a quote, completing a job)
 * must land whether or not the digest can be queued.
 *
 * Re-queueing the same job for the same kind before the digest goes out is a
 * no-op — the partial unique index keeps one pending row per job per kind.
 */
export async function queueDigestEvent(kind: DigestKind, projectId: number): Promise<void> {
  try {
    const db = await getDb();
    await db.query(
      `INSERT INTO email_digest_events (kind, project_id) VALUES ($1, $2)
       ON CONFLICT (kind, project_id) WHERE sent_at IS NULL DO NOTHING`,
      [kind, projectId]
    );
  } catch (err) {
    console.error(`[email] could not queue ${kind} digest event for project ${projectId}:`, err);
  }
}

/** The day's sold work: a quote was marked sold and converted into a project. */
export const queueNewProjectDigest = (projectId: number) =>
  queueDigestEvent('new_project', projectId);

/** The day's completed jobs: a project was marked complete. */
export const queueJobCompletedDigest = (projectId: number) =>
  queueDigestEvent('job_completed', projectId);

/**
 * Everything still unsent for one kind, oldest first, with the project fields
 * the email lists. Rows whose project has been deleted are gone already — the
 * foreign key cascades — so a deleted job is never reported.
 */
export async function pendingDigestEvents(kind: DigestKind): Promise<DigestEvent[]> {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT e.id, e.project_id, e.created_at,
            p.name, p.customer, p.value, p.quote_number, p.category, p.status
       FROM email_digest_events e
       JOIN projects p ON p.id = e.project_id
      WHERE e.kind = $1 AND e.sent_at IS NULL
      ORDER BY e.created_at, e.id`,
    [kind]
  );
  return rows as DigestEvent[];
}

/** Stamp rows as reported so the next digest doesn't repeat them. */
export async function markDigestEventsSent(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  await db.query('UPDATE email_digest_events SET sent_at = now() WHERE id = ANY($1::int[])', [ids]);
}

/**
 * Drop reported rows once they're well past any digest that could name them.
 * The queue is an outbox, not a history — the projects table is the record.
 */
export async function pruneSentDigestEvents(days = 60): Promise<void> {
  const db = await getDb();
  await db.query(
    `DELETE FROM email_digest_events
      WHERE sent_at IS NOT NULL AND sent_at < now() - ($1 || ' days')::interval`,
    [String(days)]
  );
}
