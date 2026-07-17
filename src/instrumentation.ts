/*
 * Next.js instrumentation hook. register() runs once when a server process
 * (worker) boots — the right place to start the email cron scheduler exactly
 * once per worker.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startEmailScheduler } = await import('@/lib/email/scheduler');
    startEmailScheduler();
  }
}
