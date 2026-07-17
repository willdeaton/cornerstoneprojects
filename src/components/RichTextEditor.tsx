'use client';

import { useEffect, useRef } from 'react';
import { isRichTextEmpty } from '@/lib/richtext';

/**
 * Minimal rich-text editor for quote line-item descriptions: bold, underline,
 * and bullet lists, stored as a small HTML string. Built on contentEditable +
 * document.execCommand so it needs no dependencies; the output is sanitized to
 * a safe allowlist wherever it's rendered (see @/lib/richtext).
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Push external value into the DOM only when it actually differs, so we never
  // reset the caret while the user is typing (onInput drives `value`).
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value) el.innerHTML = value ?? '';
  }, [value]);

  function emit() {
    const el = ref.current;
    if (!el) return;
    const html = el.innerHTML;
    // Normalize a visually-empty editor (execCommand leaves stray <br>/<div>)
    // to '' so blank lines are dropped on save.
    onChange(isRichTextEmpty(html) ? '' : html);
  }

  function exec(command: string) {
    ref.current?.focus();
    document.execCommand(command, false);
    emit();
  }

  return (
    <div className="rounded-lg border border-black/15 bg-white transition focus-within:border-brand-green focus-within:ring-2 focus-within:ring-brand-green/30">
      <div className="flex items-center gap-0.5 border-b border-black/10 px-1.5 py-1">
        <ToolbarButton label="Bold" onClick={() => exec('bold')}>
          <span className="font-bold">B</span>
        </ToolbarButton>
        <ToolbarButton label="Underline" onClick={() => exec('underline')}>
          <span className="underline">U</span>
        </ToolbarButton>
        <ToolbarButton label="Bullet list" onClick={() => exec('insertUnorderedList')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
            <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
            <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
            <path d="M9 6h11M9 12h11M9 18h11" />
          </svg>
        </ToolbarButton>
      </div>
      <div
        ref={ref}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        data-placeholder={placeholder}
        className="rte-content min-h-[3.75rem] w-full px-3 py-2 text-sm text-brand-ink outline-none"
      />
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // Keep the text selection while clicking the toolbar so the command has
      // something to act on.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm text-brand-gray hover:bg-black/5"
    >
      {children}
    </button>
  );
}
