'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface ComboboxOption {
  /** Stable value stored when the option is chosen. */
  value: string;
  /** Primary line shown in the field and the list. */
  label: string;
  /** Optional secondary line shown under the label in the list. */
  detail?: string;
}

/**
 * A searchable typeahead: type to filter the options, arrow/enter to choose, and
 * an optional inline "+ Add …" row so a name that isn't listed can be created on
 * the spot. Mirrors the hospital-location picker pattern used across the app.
 */
export function Combobox({
  options,
  value,
  onSelect,
  onAddNew,
  addNewLabel,
  placeholder = 'Search…',
  disabled = false,
  emptyText = 'No matches',
}: {
  options: ComboboxOption[];
  /** Currently selected option value, or '' when nothing is chosen. */
  value: string;
  onSelect: (value: string) => void;
  /** Called with the typed text when the "+ Add …" row is chosen. Omit to hide it. */
  onAddNew?: (typed: string) => void;
  /** Renders the add row, e.g. (typed) => `Add "${typed}" as new hospital`. */
  addNewLabel?: (typed: string) => string;
  placeholder?: string;
  disabled?: boolean;
  emptyText?: string;
}) {
  const selected = options.find((o) => o.value === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // While closed the field shows the chosen label; typing switches it to the query.
  const display = open ? query : selected?.label ?? '';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) || (o.detail?.toLowerCase().includes(q) ?? false)
    );
  }, [options, query]);

  const typed = query.trim();
  const showAdd =
    !!onAddNew &&
    typed.length > 0 &&
    !options.some((o) => o.label.toLowerCase() === typed.toLowerCase());
  const rowCount = filtered.length + (showAdd ? 1 : 0);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function openList() {
    if (disabled) return;
    setQuery('');
    setActive(0);
    setOpen(true);
  }

  function choose(index: number) {
    if (showAdd && index === filtered.length) {
      onAddNew?.(typed);
    } else {
      const opt = filtered[index];
      if (opt) onSelect(opt.value);
    }
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rowCount - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rowCount > 0) choose(Math.min(active, rowCount - 1));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className="input"
        value={display}
        placeholder={selected ? selected.label : placeholder}
        disabled={disabled}
        onFocus={openList}
        onClick={openList}
        onChange={(e) => {
          if (!open) setOpen(true);
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-black/10 bg-white py-1 shadow-lg"
        >
          {filtered.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`cursor-pointer px-3 py-2 text-sm ${
                i === active ? 'bg-brand-green/10' : ''
              } ${o.value === value ? 'font-semibold' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
            >
              <div className="text-brand-ink">{o.label}</div>
              {o.detail && <div className="text-xs text-brand-gray">{o.detail}</div>}
            </li>
          ))}

          {filtered.length === 0 && !showAdd && (
            <li className="px-3 py-2 text-sm text-brand-gray">{emptyText}</li>
          )}

          {showAdd && (
            <li
              role="option"
              aria-selected={active === filtered.length}
              className={`flex cursor-pointer items-center gap-1.5 border-t border-black/5 px-3 py-2 text-sm font-medium text-brand-green-dark ${
                active === filtered.length ? 'bg-brand-green/10' : ''
              }`}
              onMouseEnter={() => setActive(filtered.length)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(filtered.length);
              }}
            >
              <span className="text-base leading-none">+</span>
              <span>{addNewLabel ? addNewLabel(typed) : `Add “${typed}”`}</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
