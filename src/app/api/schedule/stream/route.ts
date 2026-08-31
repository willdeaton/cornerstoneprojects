import { getCurrentUser } from '@/lib/auth';
import { subscribeToScheduleChanges, type ScheduleEvent } from '@/lib/schedule-live';

/**
 * The live schedule feed: an open connection that says nothing until the
 * schedule changes, and then says so to everybody at once.
 *
 * Server-sent events rather than a websocket, because the traffic only ever
 * goes one way — the browser has server actions for everything it wants to
 * say — and because EventSource reconnects on its own when a phone drops off
 * the network, which is most of what reliability means here.
 *
 * The events carry no schedule in them, only the news that there is one. Each
 * browser re-reads through the page it already has, so what anybody is allowed
 * to see is still decided by the page that renders it: an employee re-reading
 * gets their own week, exactly as they got it on first load.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A comment down the wire every so often, to stop an idle connection being
 * dropped by a proxy or a phone that has decided nothing is happening.
 */
const HEARTBEAT_MS = 25_000;

export async function GET(req: Request) {
  // Signed in is the whole bar: the feed says only that the schedule moved,
  // and the pages behind it are what decide who sees what.
  const me = await getCurrentUser();
  if (!me) return new Response('Unauthorized', { status: 401 });

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        unsubscribe = null;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        try {
          controller.close();
        } catch {
          // Already closed from the other end, which is the usual way this goes.
        }
      };

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The browser went away mid-write: stop listening on its behalf.
          close();
        }
      };

      // Something has to go out straight away, or EventSource sits on an open
      // socket without ever firing `open` — and the client uses `open` to know
      // it can stop falling back to polling.
      send(': connected\n\n');

      unsubscribe = subscribeToScheduleChanges((event: ScheduleEvent) => {
        send(`event: schedule\ndata: ${JSON.stringify(event)}\n\n`);
      });

      heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
      heartbeat.unref?.();

      // Closing the tab, navigating away, or losing signal all land here.
      req.signal.addEventListener('abort', close);
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      unsubscribe = null;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // `no-transform` matters as much as `no-cache`: a proxy that decides to
      // compress or buffer this stream holds every event until it has enough
      // bytes to bother sending, which is exactly never.
      'Cache-Control': 'private, no-cache, no-store, no-transform, must-revalidate',
      Connection: 'keep-alive',
      // Nginx-family proxies buffer by default; this is how you ask them not to.
      'X-Accel-Buffering': 'no',
    },
  });
}
