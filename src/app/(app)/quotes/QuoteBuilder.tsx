'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { money, dateTime } from '@/lib/format';
import { sanitizeRichText, isRichTextEmpty, richTextToPlain } from '@/lib/richtext';
import { blockTotals } from '@/lib/quote-math';
import { Modal } from '@/components/Modal';
import { Combobox } from '@/components/Combobox';
import { RichTextEditor } from '@/components/RichTextEditor';
import { UnitSelect } from '@/components/UnitSelect';
import { CategorySelect } from '@/components/CategorySelect';
import { useListHref } from '@/components/ListMemory';
import type {
  LineItemInput,
  QuoteDocInput,
  QuoteLineItem,
  QuoteWithItems,
  QuoteFile,
  CustomerWithContacts,
  CustomerContact,
  PricingItem,
  Unit,
  Category,
} from '@/lib/types';
import { COST_TYPES } from '@/lib/types';
import { createQuoteDocAction, updateQuoteDocAction } from '@/app/actions/quotes';
import { quickAddPricingItemAction, quickAddCustomerAction, quickAddContactAction } from '@/app/actions/catalog';
import { clearQuoteDraft, quoteDraftKey } from '@/lib/quote-draft';
import { useQuoteDraft } from './useQuoteDraft';
import { QuoteFiles } from './QuoteFiles';

/** Internal cost worksheet row — never printed on the customer PDF. */
interface PricingRow {
  description: string;
  /** Cost category (Subcontractor, Material, …); '' when not chosen. */
  cost_type: string;
  quantity: string;
  unit: string;
  unit_price: string;
}

/** Customer-facing line printed on the PDF: a description, price, and markup %. */
interface DisplayRow {
  description: string;
  amount: string;
  /** Per-line markup as a whole-number percent string (e.g. "15"). */
  markup: string;
  /**
   * The pricing option this line belongs to, or `null` for a base line that is
   * always included. Options are priced on their own and never summed into the
   * base Total, so an empty-string name is still a real option — only `null`
   * means "base line".
   */
  option: string | null;
}

/** A worksheet row not yet in the price book, offered for saving on save. */
interface NewPriceItem {
  description: string;
  unit: string | null;
  unit_price: number;
}

/**
 * Where the user lands after saving: `'stay'` persists in place and keeps the
 * edit form open, `'list'` returns to the quotes list, `'pdf'` opens the PDF.
 */
type SaveMode = 'stay' | 'list' | 'pdf';

/** Default per-line markup for new customer-facing lines, as a whole percent. */
const DEFAULT_MARKUP = '32';

function num(v: string): number {
  const n = parseFloat(v.replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

const normDesc = (v: string) => v.trim().toLowerCase();

/** Add `days` to a YYYY-MM-DD date string, returning the same format. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function blankPricingRow(): PricingRow {
  return { description: '', cost_type: '', quantity: '1', unit: 'ea', unit_price: '' };
}
function blankDisplayRow(option: string | null = null): DisplayRow {
  return { description: '', amount: '', markup: DEFAULT_MARKUP, option };
}

/** Subtotal / markup / total for one block of lines, using the shared quote math. */
function rowTotals(rows: DisplayRow[]) {
  return blockTotals(rows.map((r) => ({ amount: num(r.amount), markup_rate: num(r.markup) / 100 })));
}

/** The option names in a row list, in first-appearance order. */
function optionKeysOf(rows: DisplayRow[]): string[] {
  const keys: string[] = [];
  for (const r of rows) {
    if (r.option !== null && !keys.includes(r.option)) keys.push(r.option);
  }
  return keys;
}

/** First unused "Option A", "Option B", … for a newly added option. */
function nextOptionName(taken: string[]): string {
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const name = `Option ${letter}`;
    if (!taken.includes(name)) return name;
  }
  return `Option ${taken.length + 1}`;
}

/**
 * Hydrate the customer-facing rows of a stored quote. Base lines come first,
 * then the option lines grouped by their stored `option_group`.
 *
 * A legacy option row — an 'alternate' saved before options had line items —
 * has no `option_group`, so it becomes its own one-line option named after its
 * own text. Names are kept unique, because two identically worded legacy options
 * merged into one group would add their prices together.
 */
function initialDisplayRows(quote?: QuoteWithItems): DisplayRow[] {
  const items = quote?.line_items ?? [];
  // Rows without an explicit kind predate the split and were customer-facing.
  const stored = items.filter((li) => li.kind !== 'pricing' && li.kind !== 'alternate');
  const alternates = items.filter((li) => li.kind === 'alternate');

  const toRow = (li: QuoteLineItem, option: string | null): DisplayRow => ({
    // Normalize to editor HTML so legacy plain-text (with newlines) and any
    // stored formatting both load into the rich-text editor cleanly.
    description: sanitizeRichText(li.description),
    // Fall back to quantity × unit price for pre-split quotes with no amount.
    amount: String(li.amount ?? li.quantity * li.unit_price),
    markup: String(+((li.markup_rate ?? 0) * 100).toFixed(4)),
    option,
  });

  const base = stored.length ? stored.map((li) => toRow(li, null)) : [blankDisplayRow()];

  const named = new Set(
    alternates.map((li) => li.option_group?.trim()).filter((n): n is string => !!n)
  );
  const usedLegacy = new Set<string>();
  const options = alternates.map((li, i) => {
    const group = li.option_group?.trim();
    if (group) return toRow(li, group);
    const label = richTextToPlain(li.description).trim() || `Option ${i + 1}`;
    let name = label;
    for (let n = 2; named.has(name) || usedLegacy.has(name); n++) name = `${label} (${n})`;
    usedLegacy.add(name);
    return toRow(li, name);
  });

  return [...base, ...options];
}

/** A row plus its index in the flat `displayRows` array, which handlers act on. */
interface RowEntry {
  row: DisplayRow;
  index: number;
}

/**
 * The editable table of customer-facing lines — used both for the base lines and
 * for each pricing option's lines, so the two can never drift apart. Moves and
 * removes are scoped to the block: `entries` is already filtered to it.
 */
function LineItemTable({
  entries,
  canRemove,
  invalid,
  onChange,
  onMove,
  onRemove,
}: {
  entries: RowEntry[];
  canRemove: boolean;
  /** Rows a save is blocked on, by their index in the flat `displayRows` array. */
  invalid?: Set<number>;
  onChange: (index: number, patch: Partial<DisplayRow>) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-black/5 text-left text-xs uppercase tracking-wide text-brand-gray">
            <th className="px-2 py-2 font-semibold">Description</th>
            <th className="px-2 py-2 text-right font-semibold w-32">Price</th>
            <th className="px-2 py-2 text-right font-semibold w-24">Markup %</th>
            <th className="px-2 py-2 text-right font-semibold w-32">Line Total</th>
            <th className="px-2 py-2 w-24" />
          </tr>
        </thead>
        <tbody>
          {entries.map(({ row, index }, pos) => (
            // Keyed by the row's index in the flat array, not its position in
            // this block, so the rich-text editors never swap contents.
            <tr
              key={index}
              className={`border-b border-black/5 last:border-0 align-top ${
                invalid?.has(index) ? 'bg-red-50/60' : ''
              }`}
            >
              <td className="px-2 py-2">
                <RichTextEditor
                  value={row.description}
                  onChange={(html) => onChange(index, { description: html })}
                  placeholder="Furnish and install new carpet tile throughout corridor …"
                />
              </td>
              <td className="px-2 py-2">
                <input
                  className={`input text-right ${
                    invalid?.has(index) ? 'ring-1 ring-red-400' : ''
                  }`}
                  inputMode="decimal"
                  aria-invalid={invalid?.has(index) || undefined}
                  value={row.amount}
                  onChange={(e) => onChange(index, { amount: e.target.value })}
                  placeholder="0.00"
                />
              </td>
              <td className="px-2 py-2">
                <input
                  className="input text-right"
                  inputMode="decimal"
                  value={row.markup}
                  onChange={(e) => onChange(index, { markup: e.target.value })}
                  placeholder="0"
                />
              </td>
              <td className="px-2 py-2 text-right font-semibold text-brand-ink whitespace-nowrap">
                {money(num(row.amount) * (1 + num(row.markup) / 100), { cents: true })}
              </td>
              <td className="px-2 py-2">
                <div className="flex items-center justify-end gap-1 text-brand-gray">
                  <button type="button" aria-label="Move up" className="rounded p-1 hover:bg-black/5 disabled:opacity-30" onClick={() => onMove(index, -1)} disabled={pos === 0}>↑</button>
                  <button type="button" aria-label="Move down" className="rounded p-1 hover:bg-black/5 disabled:opacity-30" onClick={() => onMove(index, 1)} disabled={pos === entries.length - 1}>↓</button>
                  <button type="button" aria-label="Remove" className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-30" onClick={() => onRemove(index)} disabled={!canRemove}>✕</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Subtotal / markup / total for one block. Markup is computed per block so a
 * base block with no markup doesn't show a $0.00 markup row just because a
 * pricing option elsewhere on the quote has one.
 */
function TotalsPanel({
  rows,
  label,
  explain = false,
}: {
  rows: DisplayRow[];
  label: string;
  /** Show the "markup is folded into each line price" note (base block only). */
  explain?: boolean;
}) {
  const totals = rowTotals(rows);
  const anyMarkup = rows.some((r) => num(r.markup) > 0);
  return (
    <div className="mt-4 flex justify-end">
      <div className="w-full max-w-xs space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-brand-gray">Subtotal</span>
          <span className="font-semibold text-brand-ink">{money(totals.subtotal, { cents: true })}</span>
        </div>
        {anyMarkup && (
          <div className="flex justify-between">
            <span className="text-brand-gray">Markup</span>
            <span className="font-semibold text-brand-ink">{money(totals.markup, { cents: true })}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-black/10 pt-2 text-base">
          <span className="font-semibold text-brand-ink">{label}</span>
          <span className="font-bold text-brand-ink">{money(totals.total, { cents: true })}</span>
        </div>
        {anyMarkup && explain && (
          <p className="pt-1 text-xs text-brand-gray">
            Markup is folded into each line price on the customer PDF — it raises the total but
            isn&apos;t shown as its own line.
          </p>
        )}
      </div>
    </div>
  );
}

export function QuoteBuilder({
  quote,
  customers: customersProp = [],
  pricingItems: pricingItemsProp = [],
  units: unitsProp = [],
  categories: categoriesProp = [],
  defaultTerms = '',
  currentUserName = '',
  quoteFiles = [],
  initialSaved = false,
}: {
  quote?: QuoteWithItems;
  customers?: CustomerWithContacts[];
  pricingItems?: PricingItem[];
  units?: Unit[];
  categories?: Category[];
  defaultTerms?: string;
  /** Name of the signed-in user — pre-fills Prepared By on new quotes. */
  currentUserName?: string;
  quoteFiles?: QuoteFile[];
  /** Start in the just-saved state — set when arriving from a new-quote save. */
  initialSaved?: boolean;
}) {
  const router = useRouter();
  // Closing the builder returns to the quotes list the user came from — same
  // tab, same filters — not the default Open tab.
  const listHref = useListHref('quotes', '/quotes');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Rows a save is blocked on — a price with nothing to label it. Held by their
  // index in `pricingRows` / `displayRows`, which is what the tables render by.
  const [badPricing, setBadPricing] = useState<Set<number>>(new Set());
  const [badDisplay, setBadDisplay] = useState<Set<number>>(new Set());
  /**
   * Clear the last failure. Called wherever a save begins, so the red rows from
   * the previous attempt don't outlive it.
   */
  function clearProblems() {
    setError(null);
    setBadPricing(new Set());
    setBadDisplay(new Set());
  }
  // Collapsible cards. Line Items — the heart of the quote — starts open; the
  // supporting cards start collapsed so the form opens on the work that matters.
  // Collapsing only hides the inputs on screen, it never changes what gets saved.
  const [pricingOpen, setPricingOpen] = useState(false);
  const [lineItemsOpen, setLineItemsOpen] = useState(true);
  const [termsOpen, setTermsOpen] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);

  // Price book, unit list, and category list are held in state so quick-adds
  // (a new price-book entry, unit, or category) show up immediately without a
  // reload.
  const [pricingItems, setPricingItems] = useState<PricingItem[]>(pricingItemsProp);
  const [units, setUnits] = useState<Unit[]>(unitsProp);
  const [categories, setCategories] = useState<Category[]>(categoriesProp);

  // Save-time prompt: on save we gather every worksheet row that isn't in the
  // price book yet and offer them all at once as checkboxes, instead of nagging
  // per row. `savePrompt` also remembers whether the pending save should open
  // the PDF, so we can resume the save after the user answers.
  const [savePrompt, setSavePrompt] = useState<{ items: NewPriceItem[]; mode: SaveMode } | null>(null);
  const [selectedNew, setSelectedNew] = useState<Set<number>>(new Set());
  const [addingToBook, setAddingToBook] = useState(false);
  // Descriptions already offered for the price book this session, so a "skip"
  // isn't re-asked on every subsequent save.
  const promptedRef = useRef<Set<string>>(new Set());

  // A plain Save on an existing quote now persists in place instead of leaving
  // the page. Once it has saved at least once, the "Cancel" button becomes
  // "Close"; leaving with unsaved edits prompts to save first. `savedSnapshot`
  // is the serialized form state as of the last save (or initial load) so we
  // can tell whether anything has changed since.
  const [hasSavedInPlace, setHasSavedInPlace] = useState(initialSaved);
  const [closePrompt, setClosePrompt] = useState(false);

  const initialIssueDate = quote?.issue_date ?? new Date().toISOString().slice(0, 10);
  const [header, setHeader] = useState({
    quote_number: quote?.quote_number ?? '',
    customer: quote?.customer ?? '',
    customer_contact: quote?.customer_contact ?? '',
    customer_email: quote?.customer_email ?? '',
    customer_phone: quote?.customer_phone ?? '',
    customer_address: quote?.customer_address ?? '',
    project_name: quote?.project_name ?? '',
    project_location: quote?.project_location ?? '',
    category: quote?.category ?? '',
    issue_date: initialIssueDate,
    // New quotes default Valid Until to 60 days after the issue date; existing
    // quotes keep whatever was saved on them.
    valid_until: quote ? quote.valid_until ?? '' : addDays(initialIssueDate, 60),
    // New quotes pre-fill the company-wide default terms; existing quotes keep
    // whatever was saved on them (including an intentionally blank value).
    terms: quote ? quote.terms ?? '' : defaultTerms,
    notes: quote?.notes ?? '',
    // New quotes default Prepared By to whoever is creating the quote; it stays
    // editable, and existing quotes keep their saved value.
    prepared_by: quote ? quote.prepared_by ?? '' : currentUserName,
    internal_notes: quote?.internal_notes ?? '',
  });
  // Once the user edits Valid Until by hand we stop auto-syncing it to
  // issue date + 60 days. Existing quotes never auto-sync.
  const [validUntilEdited, setValidUntilEdited] = useState(!!quote);
  // Saved customers are held in state so a quick-add from the picker below shows
  // up immediately (and can be auto-selected) without a full page reload.
  const [customers, setCustomers] = useState<CustomerWithContacts[]>(customersProp);

  // Customer + contact are chosen from a single combined picker. When editing,
  // preselect the saved customer (and contact) whose name matches the stored
  // quote. A quote whose customer isn't in the saved list keeps its stored value
  // (see the "current" option below) until the user picks or adds a saved one.
  const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();
  const matchedCustomer = customers.find((c) => norm(c.name) === norm(quote?.customer));
  const matchedContact = matchedCustomer?.contacts.find(
    (ct) => norm(ct.name) === norm(quote?.customer_contact)
  );
  const [customerId, setCustomerId] = useState<string>(matchedCustomer ? String(matchedCustomer.id) : '');
  const [contactId, setContactId] = useState<string>(matchedContact ? String(matchedContact.id) : '');

  const selectedCustomer = customers.find((c) => String(c.id) === customerId);

  // The stored customer isn't one of the saved records — offer it as a "current"
  // option so editing an older one-off quote doesn't silently drop the name.
  const hasUnsavedCurrent = !matchedCustomer && !!quote?.customer;
  // Selected values for the two separate dropdowns. When the stored customer is a
  // one-off (not saved), both selects fall back to the "current" sentinel.
  const customerSelValue = customerId ? customerId : hasUnsavedCurrent ? '__current__' : '';
  const contactSelValue = contactId ? contactId : customerSelValue === '__current__' ? '__current__' : '';

  // Typeahead option lists for the customer + contact pickers.
  const customerOptions = useMemo(() => {
    const opts = customers.map((c) => ({
      value: String(c.id),
      label: c.name,
      detail: c.address ?? undefined,
    }));
    if (hasUnsavedCurrent) {
      opts.unshift({
        value: '__current__',
        label: quote?.customer ?? '',
        detail: 'current — not saved',
      });
    }
    return opts;
  }, [customers, hasUnsavedCurrent, quote?.customer]);

  const contactOptions = useMemo(() => {
    if (selectedCustomer) {
      return selectedCustomer.contacts.map((ct) => ({
        value: String(ct.id),
        label: ct.name,
        detail: [ct.title, ct.email].filter(Boolean).join(' · ') || undefined,
      }));
    }
    if (customerSelValue === '__current__') {
      return [
        {
          value: '__current__',
          label: quote?.customer_contact || '(no contact)',
          detail: 'current — not saved',
        },
      ];
    }
    return [];
  }, [selectedCustomer, customerSelValue, quote?.customer_contact]);

  // Add-customer / add-contact modal state.
  const [addMode, setAddMode] = useState<null | 'customer' | 'contact'>(null);
  const blankAddForm = { name: '', title: '', email: '', phone: '', address: '', contactName: '' };
  const [addForm, setAddForm] = useState(blankAddForm);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  /** Fill header fields from a chosen customer + optional contact. */
  function applyCustomerContact(c: CustomerWithContacts | undefined, ct: CustomerContact | undefined) {
    if (!c) {
      setHeader((h) => ({
        ...h,
        customer: '',
        customer_contact: '',
        customer_email: '',
        customer_phone: '',
        customer_address: '',
      }));
      return;
    }
    setHeader((h) => ({
      ...h,
      customer: c.name,
      customer_address: c.address ?? '',
      customer_contact: ct?.name ?? '',
      customer_email: ct?.email ?? '',
      customer_phone: ct?.phone ?? '',
    }));
  }

  function onSelectCustomer(value: string) {
    // Keep the stored one-off value untouched.
    if (value === '__current__') return;
    setCustomerId(value);
    // Picking a new customer clears any previously chosen contact.
    setContactId('');
    const c = customers.find((x) => String(x.id) === value);
    applyCustomerContact(c, undefined);
  }

  function onSelectContact(value: string) {
    // Keep the stored one-off value untouched.
    if (value === '__current__') return;
    setContactId(value);
    const ct = value ? selectedCustomer?.contacts.find((x) => String(x.id) === value) : undefined;
    applyCustomerContact(selectedCustomer, ct);
  }

  function openAdd(mode: 'customer' | 'contact', prefillName = '') {
    setAddError(null);
    setAddForm(
      mode === 'customer'
        ? { ...blankAddForm, name: prefillName }
        : { ...blankAddForm, contactName: prefillName }
    );
    setAddMode(mode);
  }

  async function confirmAdd() {
    setAddError(null);
    setAddSaving(true);
    try {
      if (addMode === 'customer') {
        const res = await quickAddCustomerAction({
          name: addForm.name,
          address: addForm.address || null,
          contact: addForm.contactName
            ? { name: addForm.contactName, title: addForm.title, email: addForm.email, phone: addForm.phone }
            : null,
        });
        if (!res.ok || !res.customer) {
          setAddError(res.error ?? 'Could not add the customer.');
          setAddSaving(false);
          return;
        }
        const created = res.customer;
        setCustomers((cs) => [...cs, created].sort((a, b) => a.name.localeCompare(b.name)));
        const newContact = created.contacts[0];
        setCustomerId(String(created.id));
        setContactId(newContact ? String(newContact.id) : '');
        applyCustomerContact(created, newContact);
      } else if (addMode === 'contact') {
        if (!selectedCustomer) {
          setAddError('Select a customer first.');
          setAddSaving(false);
          return;
        }
        const res = await quickAddContactAction({
          customer_id: selectedCustomer.id,
          name: addForm.contactName,
          title: addForm.title,
          email: addForm.email,
          phone: addForm.phone,
        });
        if (!res.ok || !res.contact) {
          setAddError(res.error ?? 'Could not add the contact.');
          setAddSaving(false);
          return;
        }
        const created = res.contact;
        setCustomers((cs) =>
          cs.map((c) => (c.id === created.customer_id ? { ...c, contacts: [...c.contacts, created] } : c))
        );
        setContactId(String(created.id));
        applyCustomerContact(selectedCustomer, created);
      }
      setAddMode(null);
      setAddSaving(false);
    } catch {
      setAddError('Could not save. You may not have permission to add customers.');
      setAddSaving(false);
    }
  }

  /**
   * When a pricing-row description matches a saved price-book entry, pull its
   * unit and unit price in. Called as the description changes so picking from
   * the dropdown fills the rest of the row.
   */
  function applyPriceBook(i: number, description: string) {
    const item = pricingItems.find((p) => normDesc(p.description) === normDesc(description));
    if (!item) {
      updatePricing(i, { description });
      return;
    }
    updatePricing(i, {
      description: item.description,
      unit: item.unit ?? '',
      unit_price: String(item.unit_price),
    });
  }

  /**
   * Gather every worksheet row that has a description and price but isn't in the
   * price book yet — the candidates offered (once, on save) for saving to the
   * pricing list. De-duplicated by description so repeats aren't offered twice.
   */
  function collectNewPricingItems(): NewPriceItem[] {
    const seen = new Set<string>();
    const out: NewPriceItem[] = [];
    for (const row of pricingRows) {
      const desc = row.description.trim();
      const price = num(row.unit_price);
      if (!desc || price <= 0) continue;
      const key = normDesc(desc);
      if (seen.has(key)) continue;
      if (pricingItems.some((p) => normDesc(p.description) === key)) continue;
      seen.add(key);
      out.push({ description: desc, unit: row.unit || null, unit_price: price });
    }
    return out;
  }

  /** Persist the checked price-book candidates, then return to finish the save. */
  async function confirmSavePrompt() {
    if (!savePrompt) return;
    const { items, mode } = savePrompt;
    const chosen = items.filter((_, i) => selectedNew.has(i));
    if (chosen.length) {
      setAddingToBook(true);
      for (const it of chosen) {
        const res = await quickAddPricingItemAction({
          description: it.description,
          unit: it.unit,
          unit_price: it.unit_price,
          category: header.category || null,
        });
        if (res.ok && res.item) setPricingItems((prev) => [...prev, res.item!]);
      }
      setAddingToBook(false);
    }
    setSavePrompt(null);
    await doSave(mode);
  }

  /** Dismiss the prompt without saving any prices, then finish the save. */
  async function skipSavePrompt() {
    if (!savePrompt) return;
    const { mode } = savePrompt;
    setSavePrompt(null);
    await doSave(mode);
  }

  // Existing quotes store every kind in one list; split them for editing.
  const existingPricing = (quote?.line_items ?? []).filter((li) => li.kind === 'pricing');

  const [pricingRows, setPricingRows] = useState<PricingRow[]>(
    existingPricing.length
      ? existingPricing.map((li) => ({
          description: li.description,
          cost_type: li.cost_type ?? '',
          quantity: String(li.quantity),
          unit: li.unit ?? '',
          unit_price: String(li.unit_price),
        }))
      : [blankPricingRow()]
  );
  // Base lines and pricing-option lines live in ONE array: a row's `option`
  // decides which block it renders in. There is deliberately no separate list of
  // option names — deriving them from the rows keeps the two from drifting and
  // means the saved row order is exactly the order on screen.
  const [displayRows, setDisplayRows] = useState<DisplayRow[]>(() => initialDisplayRows(quote));

  const set = (k: keyof typeof header) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setHeader((h) => ({ ...h, [k]: e.target.value }));

  // Serialized view of everything we persist, used to detect unsaved edits. The
  // baseline starts at the initial load and is reset to the current view after
  // each successful in-place save.
  const snapshot = useMemo(
    () => JSON.stringify({ header, pricingRows, displayRows }),
    [header, pricingRows, displayRows]
  );
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  const dirty = snapshot !== savedSnapshot;

  // The recovery net. Nothing here reaches the server — a quote is still only
  // written when somebody presses Save — but the work in the form survives a
  // closed tab, a stray Back, or a lost browser.
  const draft = useQuoteDraft({
    quoteId: quote?.id ?? 'new',
    snapshot,
    dirty,
    updatedAt: quote?.updated_at ?? null,
  });

  /**
   * Put a stashed draft back into the form. The snapshot is the builder's own
   * serialization, but it has been round-tripped through storage since, so its
   * shape is checked before anything is applied — a draft that doesn't parse is
   * dropped rather than allowed to break the form it was meant to protect.
   */
  function restoreDraft() {
    const snap = draft.restore();
    if (!snap) return;
    try {
      const parsed = JSON.parse(snap) as {
        header?: typeof header;
        pricingRows?: PricingRow[];
        displayRows?: DisplayRow[];
      };
      if (!parsed?.header || !Array.isArray(parsed.pricingRows) || !Array.isArray(parsed.displayRows)) {
        return;
      }
      // Merge over the current header rather than replacing it, so a draft taken
      // before a field was added doesn't leave that field undefined.
      setHeader((h) => ({ ...h, ...parsed.header }));
      setPricingRows(parsed.pricingRows.length ? parsed.pricingRows : [blankPricingRow()]);
      setDisplayRows(parsed.displayRows.length ? parsed.displayRows : [blankDisplayRow()]);
    } catch {
      /* an unreadable draft is simply no draft */
    }
  }

  const pricingSubtotal = useMemo(
    () => pricingRows.reduce((s, r) => s + num(r.quantity) * num(r.unit_price), 0),
    [pricingRows]
  );

  /* ---- customer-facing blocks: the base lines, then one per pricing option ---- */

  // Every row paired with its index in `displayRows`, since that's what the row
  // handlers act on.
  const entries = useMemo<RowEntry[]>(
    () => displayRows.map((row, index) => ({ row, index })),
    [displayRows]
  );
  const baseEntries = useMemo(() => entries.filter((e) => e.row.option === null), [entries]);
  const optionKeys = useMemo(() => optionKeysOf(displayRows), [displayRows]);
  const optionBlocks = useMemo(
    () =>
      optionKeys.map((key) => ({
        key,
        entries: entries.filter((e) => e.row.option === key),
      })),
    [optionKeys, entries]
  );

  // Markup is per line and folded into each line price on the PDF, so it never
  // shows as its own line to the customer even though it raises the total. Each
  // line is rounded to cents so these totals match the printed ones. Pricing
  // options are totalled one at a time and never added into the base total.
  const baseTotals = useMemo(() => rowTotals(baseEntries.map((e) => e.row)), [baseEntries]);
  // An options-only quote prints no base table and no base Total, so don't show
  // a $0.00 one here either.
  const hasBaseContent = baseEntries.some(
    (e) => !isRichTextEmpty(e.row.description) || e.row.amount.trim()
  );
  const showBaseTotal = hasBaseContent || optionBlocks.length === 0;

  /* ---- pricing rows ---- */
  function updatePricing(i: number, patch: Partial<PricingRow>) {
    setPricingRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  const addPricing = () => setPricingRows((rs) => [...rs, blankPricingRow()]);
  const removePricing = (i: number) =>
    setPricingRows((rs) => (rs.length === 1 ? rs : rs.filter((_, idx) => idx !== i)));
  function movePricing(i: number, dir: -1 | 1) {
    setPricingRows((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }
  /** Copy the internal pricing subtotal into a new base customer line. */
  function pricingToLine() {
    const line: DisplayRow = {
      description: header.project_name || 'Project total',
      amount: pricingSubtotal.toFixed(2),
      markup: DEFAULT_MARKUP,
      option: null,
    };
    setDisplayRows((rs) => {
      // Clear away untouched BASE rows only — an option's rows are never disturbed.
      const kept = rs.filter(
        (r) => r.option !== null || !isRichTextEmpty(r.description) || r.amount.trim()
      );
      // Insert after the last base row so it lands in the base block, not inside
      // whichever option happens to be last.
      const at = kept.reduce((idx, r, i) => (r.option === null ? i + 1 : idx), 0);
      return [...kept.slice(0, at), line, ...kept.slice(at)];
    });
  }

  /* ---- display rows (base lines and option lines alike) ---- */
  function updateDisplay(i: number, patch: Partial<DisplayRow>) {
    setDisplayRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  const addDisplay = (option: string | null = null) =>
    setDisplayRows((rs) => [...rs, blankDisplayRow(option)]);
  /** Remove a row. The base block always keeps at least one row; options don't. */
  const removeDisplay = (i: number) =>
    setDisplayRows((rs) => {
      const isBase = rs[i]?.option === null;
      if (isBase && rs.filter((r) => r.option === null).length === 1) return rs;
      return rs.filter((_, idx) => idx !== i);
    });
  /** Swap a row with its neighbour *inside the same block*, skipping other blocks. */
  function moveDisplay(i: number, dir: -1 | 1) {
    setDisplayRows((rs) => {
      const block = rs[i]?.option;
      if (block === undefined) return rs;
      let j = i + dir;
      while (j >= 0 && j < rs.length && rs[j].option !== block) j += dir;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }

  /* ---- pricing options: named groups of the rows above ---- */

  /** Start a new option, seeded with one blank line so it has something to show. */
  const addOptionGroup = () =>
    setDisplayRows((rs) => [...rs, blankDisplayRow(nextOptionName(optionKeysOf(rs)))]);

  /** Rename an option by retagging its rows. Renaming onto an existing name merges them. */
  const renameOptionGroup = (key: string, name: string) =>
    setDisplayRows((rs) => rs.map((r) => (r.option === key ? { ...r, option: name } : r)));

  const removeOptionGroup = (key: string) =>
    setDisplayRows((rs) => rs.filter((r) => r.option !== key));

  /** Move a whole option before/after its neighbour, regrouping rows as it goes. */
  function moveOptionGroup(key: string, dir: -1 | 1) {
    setDisplayRows((rs) => {
      const keys = optionKeysOf(rs);
      const i = keys.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= keys.length) return rs;
      const order = [...keys];
      [order[i], order[j]] = [order[j], order[i]];
      return [
        ...rs.filter((r) => r.option === null),
        ...order.flatMap((k) => rs.filter((r) => r.option === k)),
      ];
    });
  }

  /** Shared header validation for both save paths. Returns an error or null. */
  function validateHeader(): string | null {
    if (!header.customer.trim()) return 'Customer is required.';
    if (!quote && !header.quote_number.trim()) return 'Quote # is required.';
    if (!header.project_name.trim()) return 'Project / Description is required.';
    return null;
  }

  /**
   * A row carrying a price but no description is dropped on its way to the
   * database, and its money goes with it — the base Total falls, and so does the
   * quote's headline value. So stop the save and name the row instead: making
   * somebody label a line is a far smaller cost than losing a price without
   * telling them.
   *
   * Pricing-option rows are deliberately exempt. They are already kept unlabelled
   * on purpose, precisely so a real price is never lost to a missing name.
   */
  function validatePricedRows(): {
    message: string;
    pricing: Set<number>;
    display: Set<number>;
  } | null {
    const pricing = new Set<number>();
    const display = new Set<number>();
    const named: string[] = [];

    // A unit price with nothing to label it, whatever the quantity — a row
    // priced at $0 is just an unfinished row, not a loss.
    pricingRows.forEach((r, i) => {
      if (r.description.trim() || num(r.unit_price) === 0) return;
      pricing.add(i);
    });

    // Numbered as they read on screen: the base block counts its own rows.
    let basePos = 0;
    displayRows.forEach((r, i) => {
      if (r.option !== null) return;
      basePos++;
      if (!isRichTextEmpty(r.description)) return;
      if (num(r.amount) === 0) return;
      display.add(i);
      named.push(`Line ${basePos}`);
    });

    let worksheetPos = 0;
    pricingRows.forEach((r, i) => {
      worksheetPos++;
      if (pricing.has(i)) named.push(`cost worksheet row ${worksheetPos}`);
    });

    if (named.length === 0) return null;
    const shown = named.slice(0, 3).join(', ');
    const rest = named.length - 3;
    const subject = named.length === 1 ? `${shown} has` : `${shown}${rest > 0 ? ` and ${rest} more` : ''} have`;
    return {
      message: `${subject} a price but no description. Add one, or clear the price — otherwise it won't be saved.`,
      pricing,
      display,
    };
  }

  /** Run both validations, showing the first failure. True when the save may go on. */
  function validateForSave(): boolean {
    clearProblems();
    const invalid = validateHeader();
    if (invalid) {
      setError(invalid);
      return false;
    }
    const priced = validatePricedRows();
    if (priced) {
      setError(priced.message);
      setBadPricing(priced.pricing);
      setBadDisplay(priced.display);
      return false;
    }
    return true;
  }

  /**
   * Save entry point. Validates, then — if the worksheet has prices not yet in
   * the book — opens the single "add to pricing list?" prompt before saving.
   * The prompt is offered on every save, not just a new quote's first one: a
   * price typed in on a later edit is worth keeping too, and the candidates are
   * already filtered against the book, so a save with nothing new asks nothing.
   *
   * `promptedRef` remembers what has already been offered this session, so
   * somebody who said no isn't asked about the same rows again on every save.
   */
  function save(mode: SaveMode) {
    if (!validateForSave()) return;
    const newItems = collectNewPricingItems().filter(
      (it) => !promptedRef.current.has(normDesc(it.description))
    );
    if (newItems.length > 0) {
      for (const it of newItems) promptedRef.current.add(normDesc(it.description));
      // Default every candidate to checked — the common case is "yes, save these".
      setSelectedNew(new Set(newItems.map((_, i) => i)));
      setSavePrompt({ items: newItems, mode });
      return;
    }
    void doSave(mode);
  }

  async function doSave(mode: SaveMode) {
    // Re-checked here as well as in `save`, because the price-book prompt
    // re-enters through this function rather than through `save`.
    if (!validateForSave()) return;
    const items: LineItemInput[] = [
      ...pricingRows
        .filter((r) => r.description.trim())
        .map<LineItemInput>((r) => ({
          kind: 'pricing',
          description: r.description,
          quantity: num(r.quantity),
          unit: r.unit || null,
          unit_price: num(r.unit_price),
          amount: null,
          markup_rate: 0,
          cost_type: r.cost_type || null,
          option_group: null,
        })),
      // Base lines first, then each option's lines in the order shown on screen:
      // row order is stored as `position`, and that's the only record of it.
      ...displayRows
        .filter((r) => r.option === null && !isRichTextEmpty(r.description))
        .map<LineItemInput>((r) => ({
          kind: 'display',
          description: r.description,
          quantity: 1,
          unit: null,
          unit_price: 0,
          amount: num(r.amount),
          markup_rate: num(r.markup) / 100,
          cost_type: null,
          option_group: null,
        })),
      ...optionKeys.flatMap<LineItemInput>((key) => {
        // An option whose name was cleared still needs one to group by.
        const name = key.trim() || nextOptionName(optionKeys.filter((k) => k.trim()));
        return displayRows
          .filter((r) => r.option === key && (!isRichTextEmpty(r.description) || r.amount.trim()))
          .map<LineItemInput>((r) => ({
            kind: 'alternate',
            description: r.description,
            quantity: 1,
            unit: null,
            unit_price: 0,
            amount: num(r.amount),
            markup_rate: num(r.markup) / 100,
            cost_type: null,
            option_group: name,
          }));
      }),
    ];
    const payload: QuoteDocInput = {
      quote_number: header.quote_number || null,
      customer: header.customer,
      customer_contact: header.customer_contact || null,
      customer_email: header.customer_email || null,
      customer_phone: header.customer_phone || null,
      customer_address: header.customer_address || null,
      project_name: header.project_name || null,
      project_location: header.project_location || null,
      category: header.category || null,
      issue_date: header.issue_date || null,
      valid_until: header.valid_until || null,
      // Tax and quote-level markup are retired — markup is now per line item.
      tax_rate: 0,
      markup_rate: 0,
      terms: header.terms || null,
      notes: header.notes || null,
      prepared_by: header.prepared_by || null,
      internal_notes: header.internal_notes || null,
      items,
    };
    setSaving(true);
    try {
      const res = quote
        ? await updateQuoteDocAction(quote.id, payload, mode, listHref)
        : await createQuoteDocAction(payload, mode, listHref);
      if (res?.error) {
        setError(res.error);
        setSaving(false);
        return;
      }
      // The write reports how many line items reached the database. If that's
      // short of what we sent, something was dropped on the way in — say so and
      // leave the form dirty rather than showing a "Saved ✓" it hasn't earned.
      const short =
        res && 'saved' in res && typeof res.saved === 'number' && typeof res.sent === 'number'
          ? res.sent - res.saved
          : 0;

      // A save that landed is the end of the draft: the work is in the database
      // now, and a stale stash would offer to undo it.
      draft.clear();

      // 'stay' saves in place and returns here; 'list'/'pdf' redirect
      // server-side (this component unmounts before we get here).
      if (mode === 'stay') {
        // A brand-new quote has no edit URL yet — move onto the created
        // quote's edit page so the next Save updates it instead of creating
        // a duplicate. `saved=1` keeps the "Saved ✓" state across the swap.
        if (!quote && res && 'id' in res) {
          // The builder remounts on the new route under the real quote's draft
          // key, so clear the 'new' one first — otherwise a draft of the quote
          // as it was before saving outlives the quote it was a draft of.
          clearQuoteDraft(quoteDraftKey('new'));
          router.replace(`/quotes/${res.id}/edit?saved=1`);
          return;
        }
        setSaving(false);
        if (short > 0) {
          setError(
            `Saved, but ${short} line${short === 1 ? '' : 's'} did not store. Check for rows with a price and no description.`
          );
          return;
        }
        // Mark the just-saved state as the new clean baseline so the form no
        // longer reads as having unsaved edits, and flip Cancel → Close.
        setSavedSnapshot(snapshot);
        setHasSavedInPlace(true);
      }
    } catch (err) {
      // NEXT_REDIRECT is thrown on success — let it bubble to navigate.
      if (err && typeof err === 'object' && 'digest' in err && String((err as { digest: string }).digest).startsWith('NEXT_REDIRECT')) {
        throw err;
      }
      setError('Could not save the quote. Please try again.');
      setSaving(false);
    }
  }

  /**
   * Leave the builder. If there are unsaved edits, prompt to save first;
   * otherwise go straight back to the quotes list.
   */
  function handleClose() {
    if (dirty) {
      setClosePrompt(true);
      return;
    }
    router.push(listHref);
  }

  return (
    <div className="space-y-6">
      {/* Unsaved work found from a previous visit. Offered, never applied on its
          own: the form on screen is what the database has, and it stays that way
          until the user asks for the draft back. */}
      {draft.offered && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          <span className="text-brand-ink">
            You have unsaved changes to this quote from{' '}
            <span className="font-semibold">{dateTime(new Date(draft.offered.savedAt).toISOString())}</span>.
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn-secondary" onClick={draft.dismiss}>
              Discard
            </button>
            <button type="button" className="btn-primary" onClick={restoreDraft}>
              Restore
            </button>
          </div>
        </div>
      )}

      {/* Customer / project details */}
      <div className="card p-5">
        <h2 className="brand-heading mb-4 text-sm text-brand-ink">Customer &amp; Project</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Customer *</label>
            <Combobox
              value={customerSelValue}
              options={customerOptions}
              onSelect={onSelectCustomer}
              onAddNew={(typed) => openAdd('customer', typed)}
              addNewLabel={(typed) => `Add “${typed}” as new customer`}
              placeholder="Search customers…"
              emptyText="No matching customers"
            />
          </div>
          <div>
            <label className="label">Contact</label>
            <Combobox
              value={contactSelValue}
              options={contactOptions}
              onSelect={onSelectContact}
              onAddNew={
                selectedCustomer ? (typed) => openAdd('contact', typed) : undefined
              }
              addNewLabel={(typed) => `Add “${typed}” as new contact`}
              placeholder={
                selectedCustomer || customerSelValue === '__current__'
                  ? 'Search contacts…'
                  : 'Select a customer first…'
              }
              emptyText="No contacts yet"
              disabled={!selectedCustomer && customerSelValue !== '__current__'}
            />
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs text-brand-gray">
              Type to search. Not listed? Choose “Add … as new” to save it.
            </p>
          </div>
          <div>
            <label className="label">Contact Email</label>
            <input className="input" type="email" value={header.customer_email} onChange={set('customer_email')} placeholder="jane@example.com" />
          </div>
          <div>
            <label className="label">Contact Phone</label>
            <input className="input" value={header.customer_phone} onChange={set('customer_phone')} placeholder="(555) 555-0123" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Customer Address</label>
            <textarea className="input" rows={2} value={header.customer_address} onChange={set('customer_address')} placeholder="Street, City, ST ZIP" />
          </div>
          <div>
            <label className="label">Project / Description *</label>
            <input className="input" value={header.project_name} onChange={set('project_name')} placeholder="Corridor Flooring Replacement" />
          </div>
          <div>
            <label className="label">Project Location</label>
            <input className="input" value={header.project_location} onChange={set('project_location')} placeholder="Building B, 2nd floor" />
          </div>
          <div>
            <label className="label">Category</label>
            <CategorySelect
              categories={categories}
              value={header.category}
              onChange={(name) => setHeader((h) => ({ ...h, category: name }))}
              onCategoryAdded={(c) => setCategories((cs) => [...cs, c])}
            />
          </div>
          <div>
            <label className="label">Prepared By</label>
            <input className="input" value={header.prepared_by} onChange={set('prepared_by')} placeholder="Your name" />
          </div>
        </div>
      </div>

      {/* Quote meta */}
      <div className="card p-5">
        <h2 className="brand-heading mb-4 text-sm text-brand-ink">Quote Details</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Quote # {quote ? '' : '*'}</label>
            <input className="input" value={header.quote_number} onChange={set('quote_number')} placeholder="Q-2601" />
          </div>
          <div>
            <label className="label">Issue Date</label>
            <input
              className="input"
              type="date"
              value={header.issue_date}
              onChange={(e) => {
                const issue = e.target.value;
                // Until Valid Until is edited by hand, keep it tracking 60 days
                // after the issue date.
                setHeader((h) => ({
                  ...h,
                  issue_date: issue,
                  valid_until:
                    !validUntilEdited && issue ? addDays(issue, 60) : h.valid_until,
                }));
              }}
            />
          </div>
          <div>
            <label className="label">Valid Until</label>
            <input
              className="input"
              type="date"
              value={header.valid_until}
              onChange={(e) => {
                setValidUntilEdited(true);
                setHeader((h) => ({ ...h, valid_until: e.target.value }));
              }}
            />
          </div>
        </div>
      </div>

      {/* Customer-facing line items — shown on the PDF. Pricing options live
          here too: each is a named group of these same lines. */}
      <div className="card p-5">
        <button
          type="button"
          className="flex items-center gap-2 text-left"
          onClick={() => setLineItemsOpen((o) => !o)}
          aria-expanded={lineItemsOpen}
        >
          <span className="text-brand-gray transition-transform">{lineItemsOpen ? '▾' : '▸'}</span>
          <h2 className="brand-heading text-sm text-brand-ink">Line Items</h2>
        </button>
        {lineItemsOpen ? (
          <>
            <p className="mb-4 mt-1 text-xs text-brand-gray">
              What the customer sees on the quote — a description, price, and markup per line. Markup
              is folded into the line price on the PDF; the customer only sees the marked-up total.
            </p>

            <LineItemTable
              entries={baseEntries}
              canRemove={baseEntries.length > 1}
              invalid={badDisplay}
              onChange={updateDisplay}
              onMove={moveDisplay}
              onRemove={removeDisplay}
            />

            <button
              type="button"
              className="mt-2 w-full rounded-lg border border-dashed border-black/15 py-2 text-sm font-medium text-brand-gray hover:border-brand-green hover:text-brand-green"
              onClick={() => addDisplay(null)}
            >
              + Add Line
            </button>

            {showBaseTotal && (
              <TotalsPanel rows={baseEntries.map((e) => e.row)} label="Total" explain />
            )}

            {/* Pricing options — each one priced on its own, never added together */}
            {optionBlocks.map((block, bi) => (
              // Keyed by position, not by name, so renaming doesn't remount the
              // name input mid-keystroke.
              <div key={bi} className="mt-6 rounded-xl border border-black/10 bg-black/[0.02] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-brand-gray">
                    Option
                  </span>
                  <input
                    className="input flex-1 min-w-[12rem] font-semibold"
                    value={block.key}
                    onChange={(e) => renameOptionGroup(block.key, e.target.value)}
                    placeholder="2026 Pricing (projected material increase)"
                    aria-label="Option name"
                  />
                  <div className="flex items-center gap-1 text-brand-gray">
                    <button type="button" aria-label="Move option up" className="rounded p-1 hover:bg-black/5 disabled:opacity-30" onClick={() => moveOptionGroup(block.key, -1)} disabled={bi === 0}>↑</button>
                    <button type="button" aria-label="Move option down" className="rounded p-1 hover:bg-black/5 disabled:opacity-30" onClick={() => moveOptionGroup(block.key, 1)} disabled={bi === optionBlocks.length - 1}>↓</button>
                    <button type="button" aria-label="Remove option" className="rounded p-1 text-red-600 hover:bg-red-50" onClick={() => removeOptionGroup(block.key)}>✕</button>
                  </div>
                </div>

                <div className="mt-3">
                  <LineItemTable
                    entries={block.entries}
                    canRemove
                    onChange={updateDisplay}
                    onMove={moveDisplay}
                    onRemove={removeDisplay}
                  />
                </div>

                <button
                  type="button"
                  className="mt-2 w-full rounded-lg border border-dashed border-black/15 py-2 text-sm font-medium text-brand-gray hover:border-brand-green hover:text-brand-green"
                  onClick={() => addDisplay(block.key)}
                >
                  + Add Line to this option
                </button>

                <TotalsPanel
                  rows={block.entries.map((e) => e.row)}
                  label={`${block.key.trim() || 'Option'} Total`}
                />
              </div>
            ))}

            <button
              type="button"
              className="mt-4 w-full rounded-lg border border-dashed border-black/15 py-2 text-sm font-medium text-brand-gray hover:border-brand-green hover:text-brand-green"
              onClick={addOptionGroup}
            >
              + Add Pricing Option
            </button>
            <p className="mt-2 text-xs text-brand-gray">
              A pricing option is an alternative the customer picks between (e.g. “2025 Pricing”,
              “2026 Pricing”). Each option is priced from its own lines and is{' '}
              <span className="font-semibold">
                never added into the Total above or into another option
              </span>
              .
            </p>
          </>
        ) : (
          <p className="mt-1 text-xs text-brand-gray">
            Collapsed
            {showBaseTotal && (
              <>
                {' · '}Total{' '}
                <span className="font-semibold text-brand-ink">
                  {money(baseTotals.total, { cents: true })}
                </span>
              </>
            )}
            {optionBlocks.length > 0 && (
              <> · {optionBlocks.length} pricing option{optionBlocks.length === 1 ? '' : 's'}</>
            )}
          </p>
        )}
      </div>

      {/* Internal pricing worksheet — not shown on the PDF */}
      <div className="card p-5">
        <button
          type="button"
          className="flex items-center gap-2 text-left"
          onClick={() => setPricingOpen((o) => !o)}
          aria-expanded={pricingOpen}
        >
          <span className="text-brand-gray transition-transform">{pricingOpen ? '▾' : '▸'}</span>
          <h2 className="brand-heading text-sm text-brand-ink">Pricing Worksheet</h2>
        </button>
        {pricingOpen ? (
          <>
            <p className="mb-4 mt-1 text-xs text-brand-gray">
              Internal cost breakdown — <span className="font-semibold">not shown on the quote PDF</span>. Pick a saved
              price from the Description dropdown, or type your own — when you save you&apos;ll be asked
              whether to add any new prices to your pricing list. Then enter what the customer sees in Line Items above.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <thead>
                  <tr className="border-b border-black/5 text-left text-xs uppercase tracking-wide text-brand-gray">
                    <th className="px-2 py-2 font-semibold">Description</th>
                    <th className="px-2 py-2 font-semibold w-44">Type</th>
                    <th className="px-2 py-2 font-semibold w-20">Qty</th>
                    <th className="px-2 py-2 font-semibold w-24">Unit</th>
                    <th className="px-2 py-2 font-semibold w-32">Unit Price</th>
                    <th className="px-2 py-2 text-right font-semibold w-28">Amount</th>
                    <th className="px-2 py-2 w-24" />
                  </tr>
                </thead>
                <tbody>
                  {pricingRows.map((r, i) => (
                    <tr
                      key={i}
                      className={`border-b border-black/5 last:border-0 align-top ${
                        badPricing.has(i) ? 'bg-red-50/60' : ''
                      }`}
                    >
                      <td className="px-2 py-2">
                        <input
                          className={`input ${badPricing.has(i) ? 'ring-1 ring-red-400' : ''}`}
                          aria-invalid={badPricing.has(i) || undefined}
                          list="qb-pricebook"
                          value={r.description}
                          onChange={(e) => applyPriceBook(i, e.target.value)}
                          placeholder="Carpet tile, adhesive, labor …"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          className="input"
                          value={r.cost_type}
                          onChange={(e) => updatePricing(i, { cost_type: e.target.value })}
                        >
                          <option value="">— Select —</option>
                          {COST_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                          {/* Keep an unexpected stored value selectable instead of dropping it. */}
                          {r.cost_type && !COST_TYPES.includes(r.cost_type as (typeof COST_TYPES)[number]) && (
                            <option value={r.cost_type}>{r.cost_type}</option>
                          )}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <input className="input" inputMode="decimal" value={r.quantity} onChange={(e) => updatePricing(i, { quantity: e.target.value })} />
                      </td>
                      <td className="px-2 py-2">
                        <UnitSelect
                          units={units}
                          value={r.unit}
                          onChange={(label) => updatePricing(i, { unit: label })}
                          onUnitAdded={(u) => setUnits((us) => [...us, u])}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className="input"
                          inputMode="decimal"
                          value={r.unit_price}
                          onChange={(e) => updatePricing(i, { unit_price: e.target.value })}
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-2 py-2 text-right font-semibold text-brand-ink whitespace-nowrap">
                        {money(num(r.quantity) * num(r.unit_price), { cents: true })}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-end gap-1 text-brand-gray">
                          <button type="button" aria-label="Move up" className="rounded p-1 hover:bg-black/5 disabled:opacity-30" onClick={() => movePricing(i, -1)} disabled={i === 0}>↑</button>
                          <button type="button" aria-label="Move down" className="rounded p-1 hover:bg-black/5 disabled:opacity-30" onClick={() => movePricing(i, 1)} disabled={i === pricingRows.length - 1}>↓</button>
                          <button type="button" aria-label="Remove" className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-30" onClick={() => removePricing(i)} disabled={pricingRows.length === 1}>✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id="qb-pricebook">
                {pricingItems.map((p) => (
                  <option key={p.id} value={p.description}>
                    {p.unit_price
                      ? `${money(p.unit_price, { cents: true })}${p.unit ? `/${p.unit}` : ''}`
                      : ''}
                  </option>
                ))}
              </datalist>
            </div>

            <button
              type="button"
              className="mt-2 w-full rounded-lg border border-dashed border-black/15 py-2 text-sm font-medium text-brand-gray hover:border-brand-green hover:text-brand-green"
              onClick={addPricing}
            >
              + Add Item
            </button>

            <div className="mt-4 flex items-center justify-end gap-4">
              <button type="button" className="btn-secondary" onClick={pricingToLine}>
                Add subtotal as a line item ↑
              </button>
              <div className="flex items-baseline gap-3 text-sm">
                <span className="text-brand-gray">Internal subtotal</span>
                <span className="font-semibold text-brand-ink">{money(pricingSubtotal, { cents: true })}</span>
              </div>
            </div>
          </>
        ) : (
          <p className="mt-1 text-xs text-brand-gray">
            Collapsed · Internal subtotal{' '}
            <span className="font-semibold text-brand-ink">{money(pricingSubtotal, { cents: true })}</span>
          </p>
        )}
      </div>

      {/* Terms & notes */}
      <div className="card p-5">
        <button
          type="button"
          className="flex items-center gap-2 text-left"
          onClick={() => setTermsOpen((o) => !o)}
          aria-expanded={termsOpen}
        >
          <span className="text-brand-gray transition-transform">{termsOpen ? '▾' : '▸'}</span>
          <h2 className="brand-heading text-sm text-brand-ink">Terms &amp; Notes</h2>
        </button>
        {termsOpen ? (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Terms &amp; Conditions</label>
              <textarea className="input" rows={4} value={header.terms} onChange={set('terms')} placeholder="Payment due within 30 days. Pricing valid for 30 days." />
            </div>
            <div>
              <label className="label">Notes (shown on quote)</label>
              <textarea className="input" rows={4} value={header.notes} onChange={set('notes')} placeholder="Anything the customer should know." />
            </div>
          </div>
        ) : (
          // Say what's in there — new quotes arrive with the company default
          // terms pre-filled, and collapsing shouldn't hide that from the sender.
          <p className="mt-1 text-xs text-brand-gray">
            Collapsed ·{' '}
            {[header.terms.trim() && 'terms set', header.notes.trim() && 'notes set']
              .filter(Boolean)
              .join(' · ') || 'no terms or notes'}
          </p>
        )}
      </div>

      {/* Internal notes & supporting documents — never shown on the PDF */}
      <div className="card p-5">
        <button
          type="button"
          className="flex items-center gap-2 text-left"
          onClick={() => setInternalOpen((o) => !o)}
          aria-expanded={internalOpen}
        >
          <span className="text-brand-gray transition-transform">{internalOpen ? '▾' : '▸'}</span>
          <h2 className="brand-heading text-sm text-brand-ink">Internal Notes &amp; Documents</h2>
        </button>
        {internalOpen ? (
          <>
        <p className="mb-4 mt-1 text-xs text-brand-gray">
          For your team only — <span className="font-semibold">never shown on the quote PDF</span> or shared with the customer.
        </p>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label className="label">Internal Notes</label>
            <textarea
              className="input"
              rows={6}
              value={header.internal_notes}
              onChange={set('internal_notes')}
              placeholder="Cost assumptions, follow-ups, competitor info, anything the team should know…"
            />
          </div>
          <div>
            <label className="label">Supporting Documents</label>
            {quote ? (
              <QuoteFiles quoteId={quote.id} files={quoteFiles} />
            ) : (
              <p className="rounded-xl border-2 border-dashed border-black/15 bg-black/[0.02] px-4 py-6 text-center text-sm text-brand-gray">
                Save the quote first, then reopen it to attach supporting documents.
              </p>
            )}
          </div>
        </div>
          </>
        ) : (
          <p className="mt-1 text-xs text-brand-gray">
            Collapsed
            {quoteFiles.length > 0 && (
              <>
                {' · '}
                <span className="font-semibold text-brand-ink">
                  {quoteFiles.length} document{quoteFiles.length === 1 ? '' : 's'}
                </span>
              </>
            )}
          </p>
        )}
      </div>

      {savePrompt && (
        <Modal open onClose={skipSavePrompt} title="Add to your pricing list?">
          <div className="space-y-4">
            <p className="text-sm text-brand-gray">
              These worksheet items aren&apos;t in your pricing list yet. Check the ones you&apos;d like to
              save so you can reuse them on future quotes.
            </p>
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {savePrompt.items.map((it, i) => (
                <li key={`${normDesc(it.description)}-${i}`}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-black/5">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selectedNew.has(i)}
                      onChange={(e) =>
                        setSelectedNew((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(i);
                          else next.delete(i);
                          return next;
                        })
                      }
                    />
                    <span className="flex-1 text-sm text-brand-ink">{it.description}</span>
                    <span className="text-sm text-brand-gray whitespace-nowrap">
                      {money(it.unit_price, { cents: true })}
                      {it.unit ? `/${it.unit}` : ''}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={skipSavePrompt} disabled={addingToBook || saving}>
                Skip &amp; save quote
              </button>
              <button type="button" className="btn-primary" onClick={confirmSavePrompt} disabled={addingToBook || saving}>
                {addingToBook
                  ? 'Adding…'
                  : selectedNew.size > 0
                    ? `Add ${selectedNew.size} & save quote`
                    : 'Save quote'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {addMode && (
        <Modal
          open
          onClose={() => setAddMode(null)}
          title={addMode === 'customer' ? 'Add new customer' : `Add contact to ${selectedCustomer?.name ?? 'customer'}`}
        >
          <div className="space-y-4">
            {addMode === 'customer' && (
              <div>
                <label className="label">Customer Name *</label>
                <input
                  className="input"
                  value={addForm.name}
                  onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="ARH-Highlands"
                  autoFocus
                />
              </div>
            )}
            <div>
              <label className="label">Contact Name{addMode === 'contact' ? ' *' : ''}</label>
              <input
                className="input"
                value={addForm.contactName}
                onChange={(e) => setAddForm((f) => ({ ...f, contactName: e.target.value }))}
                placeholder="Jane Doe"
                autoFocus={addMode === 'contact'}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Title</label>
                <input
                  className="input"
                  value={addForm.title}
                  onChange={(e) => setAddForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Facilities Manager"
                />
              </div>
              <div>
                <label className="label">Contact Email</label>
                <input
                  className="input"
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="jane@example.com"
                />
              </div>
              <div>
                <label className="label">Contact Phone</label>
                <input
                  className="input"
                  value={addForm.phone}
                  onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="(555) 555-0123"
                />
              </div>
              {addMode === 'customer' && (
                <div>
                  <label className="label">Customer Address</label>
                  <input
                    className="input"
                    value={addForm.address}
                    onChange={(e) => setAddForm((f) => ({ ...f, address: e.target.value }))}
                    placeholder="Street, City, ST ZIP"
                  />
                </div>
              )}
            </div>
            {addError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{addError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setAddMode(null)} disabled={addSaving}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={confirmAdd} disabled={addSaving}>
                {addSaving ? 'Saving…' : addMode === 'customer' ? 'Add customer' : 'Add contact'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {quote && hasSavedInPlace && !dirty && !saving && (
          <span className="mr-auto text-sm font-medium text-brand-green">Saved ✓</span>
        )}
        {quote ? (
          <>
            {/* The quote already exists, so leaving is always a Close — never a
                Cancel. Unsaved edits are still caught by handleClose. */}
            <button type="button" className="btn-secondary" onClick={handleClose} disabled={saving}>
              Close
            </button>
            <button type="button" className="btn-secondary" onClick={() => save('stay')} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn-primary" onClick={() => save('pdf')} disabled={saving}>
              {saving ? 'Saving…' : 'Save & View PDF'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-secondary" onClick={handleClose} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn-secondary" onClick={() => save('stay')} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn-primary" onClick={() => save('pdf')} disabled={saving}>
              {saving ? 'Saving…' : 'Create & View PDF'}
            </button>
          </>
        )}
      </div>

      {closePrompt && (
        <Modal open onClose={() => setClosePrompt(false)} title="Save changes before closing?">
          <div className="space-y-4">
            <p className="text-sm text-brand-gray">
              This quote has unsaved changes. Do you want to save them before closing?
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setClosePrompt(false)} disabled={saving}>
                Keep editing
              </button>
              <button
                type="button"
                className="btn-secondary text-red-600"
                onClick={() => {
                  setClosePrompt(false);
                  // Discarding means discarding: leaving the stash behind would
                  // offer the edits back the next time the quote is opened.
                  draft.clear();
                  router.push(listHref);
                }}
                disabled={saving}
              >
                Discard &amp; close
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setClosePrompt(false);
                  // 'list' saves and returns to the quotes list — i.e. save & close.
                  save('list');
                }}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save & close'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
