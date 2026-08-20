'use client';

import { useEffect } from 'react';
import { useEnterTransition } from './useEnterTransition';

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  // Keeps the dialog mounted through its exit transition and hands us the
  // `data-state` the stylesheet animates against.
  const { render, state } = useEnterTransition(open);

  useEffect(() => {
    if (!render) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [render, onClose]);

  if (!render) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      onMouseDown={onClose}
    >
      {/* Scrim: brand ink rather than pure black, with a touch of blur so the
          page behind reads as a material instead of a grey wash. */}
      <div
        aria-hidden
        data-state={state}
        className="anim-scrim fixed inset-0 bg-brand-ink/40 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        data-state={state}
        // Modals are the one popover that keeps `transform-origin: center` —
        // they aren't anchored to a trigger, they arrive in the middle.
        className={`anim-modal relative my-8 w-full rounded-xl border border-surface-line bg-white shadow-modal ${
          wide ? 'max-w-3xl' : 'max-w-md'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-surface-line px-6 py-4">
          <h3 className="brand-heading text-base text-brand-ink">{title}</h3>
          <button
            onClick={onClose}
            className="-mr-1.5 -mt-0.5 rounded-lg p-1.5 text-brand-gray transition-[background-color,color,transform] duration-150 ease-out hover:bg-black/[0.05] hover:text-brand-ink active:scale-95"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
