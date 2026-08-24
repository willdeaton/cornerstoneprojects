'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  readListHref,
  readListScroll,
  rememberListHref,
  safeListHref,
  writeListScroll,
} from '@/lib/list-state';

/** The list URL as the user currently sees it, tab and all. */
function useCurrentHref(): string {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  return query ? `${pathname}?${query}` : pathname;
}

const LEAVE_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

/**
 * Dropped into a list page: records the URL a "← Back" link should return to,
 * and puts the page back where the user left it scroll-wise.
 *
 * Renders nothing.
 */
export function ListMemory({ listKey }: { listKey: string }) {
  const href = useCurrentHref();

  useEffect(() => {
    rememberListHref(listKey, href);

    // Where this URL was last left. No memory of it means the top: the "← Back"
    // links opt out of the router's own scroll reset (see BackToList), so this
    // is the only thing deciding where the list lands.
    const target = readListScroll(listKey, href) ?? 0;
    let done = false;
    const timers: number[] = [];

    function restore() {
      if (!done) window.scrollTo(0, target);
    }
    restore();
    // Re-asserted for a moment rather than set once: the rows may still be
    // filtering themselves back into place, so the page can be too short to
    // hold the old offset on the first try.
    if (target > 0) {
      for (const delay of [40, 90, 160, 260, 400]) {
        timers.push(window.setTimeout(restore, delay));
      }
    }

    /** The moment the user scrolls for themselves, stop putting them back. */
    function stopRestoring() {
      done = true;
    }
    for (const evt of LEAVE_EVENTS) {
      window.addEventListener(evt, stopRestoring, { passive: true });
    }

    // Recorded as the user leaves — on the click that navigates, before it
    // happens — rather than while they scroll. The router scrolls the incoming
    // page to the top, and that must not be mistaken for where the list was
    // left. `pagehide` covers a reload or a jump out of the app.
    function save() {
      writeListScroll(listKey, href, window.scrollY);
    }
    document.addEventListener('click', save, true);
    window.addEventListener('pagehide', save);

    return () => {
      done = true;
      for (const t of timers) clearTimeout(t);
      for (const evt of LEAVE_EVENTS) window.removeEventListener(evt, stopRestoring);
      document.removeEventListener('click', save, true);
      window.removeEventListener('pagehide', save);
    };
  }, [listKey, href]);

  return null;
}

/**
 * The remembered URL for a list, falling back to the plain list path until
 * after mount (sessionStorage isn't there during the server render).
 */
export function useListHref(listKey: string, fallback: string): string {
  const [href, setHref] = useState(fallback);
  const settled = useRef(false);

  useEffect(() => {
    // Read once — a re-render shouldn't move the target out from under a click
    // that's already in flight.
    if (settled.current) return;
    settled.current = true;
    setHref(safeListHref(readListHref(listKey), fallback));
  }, [listKey, fallback]);

  return href;
}

/**
 * A "← Back to <list>" link that returns to the tab the user came from.
 *
 * `scroll={false}` hands the scroll position to the list page's `ListMemory`,
 * which puts the user back where they were instead of at the top.
 */
export function BackToList({
  listKey,
  fallback,
  className,
  children,
}: {
  listKey: string;
  fallback: string;
  className?: string;
  children: React.ReactNode;
}) {
  const href = useListHref(listKey, fallback);
  return (
    <Link href={href} scroll={false} className={className}>
      {children}
    </Link>
  );
}
