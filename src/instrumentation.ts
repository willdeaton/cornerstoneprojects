/*
 * Next.js instrumentation hook. register() runs once when a server process
 * (worker) boots.
 *
 * Two background jobs run here: the Monday-morning weekly time-approval email
 * (lib/approval-scheduler.ts) and the end-of-day sold-work / completed-jobs
 * digests (lib/digest-scheduler.ts). Both are imported INSIDE the
 * `NEXT_RUNTIME === 'nodejs'` branch on purpose: NEXT_RUNTIME is inlined at
 * build time, so the branch (and the whole pg/data/email dependency tree behind
 * it) is dead-code-eliminated from the Edge bundle, where `pg` can't resolve.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startApprovalEmailScheduler } = await import('./lib/approval-scheduler');
    startApprovalEmailScheduler();
    const { startDailyDigestScheduler } = await import('./lib/digest-scheduler');
    startDailyDigestScheduler();
  }
}
