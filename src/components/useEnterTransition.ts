'use client';

import { useEffect, useState } from 'react';

/**
 * Drives a CSS enter/exit transition for UI that mounts and unmounts (modals,
 * popovers, flyouts).
 *
 * Returns `render` — keep the element in the tree while this is true, so it
 * survives long enough to animate out — and `state`, which belongs on a
 * `data-state` attribute the stylesheet targets (see `.anim-modal` /
 * `.anim-pop` in globals.css).
 *
 * The flip to 'open' deliberately waits *two* frames. A `requestAnimationFrame`
 * callback runs before the next paint, so with a single frame the browser
 * commits the mounted element and flips it to its open style without ever
 * painting the closed one — and a transition with no starting value paints is
 * skipped outright. The first frame lets the closed style paint; the second
 * transitions away from it.
 *
 * Transitions rather than keyframes throughout, so an element re-triggered
 * mid-flight retargets from where it currently is instead of restarting.
 */
export function useEnterTransition(open: boolean, exitMs = 140) {
  const [render, setRender] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setRender(true);
      return;
    }
    setShown(false);
    const t = setTimeout(() => setRender(false), exitMs);
    return () => clearTimeout(t);
  }, [open, exitMs]);

  useEffect(() => {
    if (!open || !render) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [open, render]);

  return { render, state: (shown ? 'open' : 'closed') as 'open' | 'closed' };
}
