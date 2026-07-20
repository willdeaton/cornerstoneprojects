'use client';

import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * A kebab (⋮) action menu whose popup is rendered in a portal on <body> with
 * fixed positioning. Because it lives outside the page's scroll/overflow
 * containers it is never clipped by a table's `overflow-hidden` / `overflow-auto`
 * wrapper, so every option is visible without scrolling. It aligns to the
 * trigger's right edge and automatically flips upward when there isn't room
 * below.
 *
 * `children` is a render prop that receives a `close()` callback so menu items
 * can dismiss the menu after acting.
 */
export function DropdownMenu({
  width = 192,
  disabled = false,
  ariaLabel = 'Actions',
  children,
}: {
  width?: number;
  disabled?: boolean;
  ariaLabel?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const close = useCallback(() => setOpen(false), []);

  const position = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const menuH = menuRef.current?.offsetHeight ?? 0;
    const margin = 8;
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < menuH + margin && r.top > spaceBelow;

    let top = openUp ? r.bottom - menuH - r.height - 4 : r.bottom + 4;
    top = Math.max(margin, Math.min(top, window.innerHeight - menuH - margin));

    let left = r.right - width;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

    setCoords({ top, left });
  }, [width]);

  // Measure and place once the menu is in the DOM.
  useLayoutEffect(() => {
    if (open) position();
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const reposition = () => position();
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', reposition);
    // capture=true so scrolls inside any ancestor container keep the menu anchored
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, position]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="rounded-lg px-2 py-1 text-brand-gray hover:bg-black/5 disabled:opacity-50"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>

      {open &&
        mounted &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: 'fixed',
              top: coords?.top ?? -9999,
              left: coords?.left ?? -9999,
              width,
              maxHeight: 'calc(100vh - 16px)',
              visibility: coords ? 'visible' : 'hidden',
            }}
            className="z-50 overflow-y-auto rounded-lg border border-black/10 bg-white py-1 text-sm shadow-card-hover"
          >
            {children(close)}
          </div>,
          document.body
        )}
    </>
  );
}
