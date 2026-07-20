/*
 * Next.js instrumentation hook. register() runs once when a server process
 * (worker) boots. All automated emails are now event-driven (sent inline from
 * the triggering action), so there is no background scheduler to start here.
 */
export async function register() {
  // No startup work required.
}
