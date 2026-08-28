'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps whatever schedule is on screen showing what is actually in the
 * database, on every device, without anybody pulling to refresh.
 *
 * The live feed does the work: /api/schedule/stream stays open and says so the
 * moment anyone saves, and this re-reads the page. Around that sit the three
 * ways a browser quietly stops hearing anything, each of which has bitten a
 * crew looking at yesterday's dates:
 *
 *  · The tab was in the background, or the phone was locked. Coming back is a
 *    read, because whatever is on screen is however old the tab is.
 *  · The page came out of the back/forward cache — a phone switching apps,
 *    most commonly — where the whole page, feed included, was frozen mid-air.
 *    That needs a read AND a fresh connection; the old one is not coming back.
 *  · The feed never connected at all, or connected and died: a proxy that
 *    buffers, a captive wifi portal, a network that eats long connections.
 *    A slow poll runs underneath for exactly this, and only while the feed is
 *    down, so a working feed costs nothing.
 *
 * A refresh during a save is held until the save finishes. The two would
 * otherwise race, and the board would flicker back through the state the save
 * had already left behind.
 */

/** How often to re-read while the live feed is NOT connected. */
const FALLBACK_POLL_MS = 45_000;

/** Changes inside this window land as one re-read. */
const DEBOUNCE_MS = 300;

export function useScheduleLive({ paused = false }: { paused?: boolean } = {}) {
  const router = useRouter();
  const pausedRef = useRef(paused);
  /** A change arrived while a save was in flight, and still owes a re-read. */
  const missedRef = useRef(false);

  // Read through a ref so the effect below is set up once, for the life of the
  // page, instead of tearing the feed down and rebuilding it on every save.
  useEffect(() => {
    pausedRef.current = paused;
    if (!paused && missedRef.current) {
      missedRef.current = false;
      router.refresh();
    }
  }, [paused, router]);

  useEffect(() => {
    let source: EventSource | null = null;
    let connected = false;
    /** Set once the feed has been up, so a reconnect is known to be a re-connect. */
    let everConnected = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let gone = false;

    const refresh = () => {
      if (gone) return;
      if (pausedRef.current) {
        missedRef.current = true;
        return;
      }
      router.refresh();
    };

    const refreshSoon = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(refresh, DEBOUNCE_MS);
    };

    const open = () => {
      if (gone || source) return;
      try {
        source = new EventSource('/api/schedule/stream');
      } catch {
        // No EventSource, or the browser refused it: the poll below covers it.
        return;
      }
      source.onopen = () => {
        connected = true;
        // Anything that happened while the feed was down was missed, so a
        // reconnection is itself news. The first connection isn't: the page
        // was rendered a moment ago.
        if (everConnected) refreshSoon();
        everConnected = true;
      };
      source.addEventListener('schedule', refreshSoon);
      source.onerror = () => {
        // EventSource retries on its own; this only tracks whether it is
        // currently up, so the fallback poll knows whether it is needed.
        connected = false;
      };
    };

    const reopen = () => {
      source?.close();
      source = null;
      connected = false;
      open();
    };

    open();

    // Back in front of somebody: what is on screen is as old as the tab.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!connected) reopen();
      refresh();
    };
    // Restored from the back/forward cache. The page and its feed were frozen,
    // and the feed does not thaw — it has to be rebuilt.
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      reopen();
      refresh();
    };
    // Online again after a dead spot, which the feed may not have noticed yet.
    const onOnline = () => {
      if (!connected) reopen();
      refresh();
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onOnline);

    // The backstop. Only fires when the feed is down, and skips a hidden tab —
    // no point re-reading a page nobody is looking at, and `onVisible` reads it
    // the moment they are.
    const poll = setInterval(() => {
      if (connected) return;
      if (document.visibilityState !== 'visible') return;
      refresh();
    }, FALLBACK_POLL_MS);

    return () => {
      gone = true;
      clearInterval(poll);
      if (debounce) clearTimeout(debounce);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onOnline);
      source?.close();
      source = null;
    };
  }, [router]);
}
