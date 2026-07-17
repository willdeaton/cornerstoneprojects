'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { money } from '@/lib/format';
import { sanitizeRichText, isRichTextEmpty } from '@/lib/richtext';
import { Modal } from '@/components/Modal';
import { RichTextEditor } from '@/components/RichTextEditor';
import { UnitSelect } from '@/components/UnitSelect';
import type {
  LineItemInput,
  QuoteDocInput,
  QuoteWithItems,
  CustomerWithContacts,
  PricingItem,
  Unit,
} from '@/lib/types';
import { createQuoteDocAction, updateQuoteDocAction } from '@/app/actions/quotes';
import { quickAddPricingItemAction } from '@/app/actions/catalog';

/** Internal cost worksheet row — never printed on the customer PDF. */
interface PricingRow {
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
}

/** Customer-facing line printed on the PDF: a description and a total price. */
interface DisplayRow {
  description: string;
  amount: string;
}

/** A worksheet row not yet in the price book, offered for saving on save. */
interface NewPriceItem {
  description: string;
  unit: string | null;
  unit_price: number;
}

const CATEGORIES = [
  'Flooring',
  'Painting',
  'Renovation',
  'Roofing',
  'Restoration',
  'Maintenance',
  'Janitorial',
  'Grounds',
];

function num(v: string): number {
  const n = parseFloat(v.replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

const normDesc = (v: string) => v.trim().toLowerCase();

function blankPricingRow(): PricingRow {
  return { description: '', quantity: '1', unit: 'ea', unit_price: '' };
}
function blankDisplayRow(): DisplayRow {
  return { description: '', amount: '' };
}

export function QuoteBuilder({
  quote,
  customers = [],
  pricingItems: pricingItemsProp = [],
  units: unitsProp = [],
  defaultTerms = '',
}: {
  quote?: QuoteWithItems;
  customers?: CustomerWithContacts[];
  pricingItems?: PricingItem[];
  units?: Unit[];
  defaultTerms?: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pricingOpen, setPricingOpen] = useState(true);

  // Price book and unit list are held in state so quick-adds from the worksheet
  // (a new price-book entry, a new unit) show up immediately without a reload.
  const [pricingItems, setPricingItems] = useState<PricingItem[]>(pricingItemsProp);
  const [units, setUnits] = useState<Unit[]>(unitsProp);

  // Save-time prompt: on save we gather every worksheet row that isn't in the
  // price book yet and offer them all at once as checkboxes, instead of nagging
  // per row. `savePrompt` also remembers whether the pending save should open
  // the PDF, so we can resume the save after the user answers.
  const [savePrompt, setSavePrompt] = useState<{ items: NewPriceItem[]; viewPdf: boolean } | null>(null);
  const [selectedNew, setSelectedNew] = useState<Set<number>>(new Set());
  const [addingToBook, setAddingToBook] = useState(false);

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
    issue_date: quote?.issue_date ?? new Date().toISOString().slice(0, 10),
    valid_until: quote?.valid_until ?? '',
    // New quotes pre-fill the company-wide default terms; existing quotes keep
    // whatever was saved on them (including an intentionally blank value).
    terms: quote ? quote.terms ?? '' : defaultTerms,
    notes: quote?.notes ?? '',
    prepared_by: quote?.prepared_by ?? '',
  });
  const [taxPercent, setTaxPercent] = useState<string>(
    quote ? String(+(quote.tax_rate * 100).toFixed(4)) : '0'
  );
  const [markupPercent, setMarkupPercent] = useState<string>(
    quote ? String(+(quote.markup_rate * 100).toFixed(4)) : '0'
  );

  // Customer picker. A saved customer is chosen by its id; '__other__' means a
  // one-off customer typed by hand. When editing, preselect the saved customer
  // (and contact) whose name matches the stored quote.
  const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();
  const matchedCustomer = customers.find((c) => norm(c.name) === norm(quote?.customer));
  const [customerId, setCustomerId] = useState<string>(
    matchedCustomer ? String(matchedCustomer.id) : quote?.customer ? '__other__' : customers.length ? '' : '__other__'
  );
  const matchedContact = matchedCustomer?.contacts.find(
    (ct) => norm(ct.name) === norm(quote?.customer_contact)
  );
  const [contactId, setContactId] = useState<string>(matchedContact ? String(matchedContact.id) : '');

  const selectedCustomer = customers.find((c) => String(c.id) === customerId);

  function onSelectCustomer(value: string) {
    setCustomerId(value);
    setContactId('');
    if (value === '__other__' || value === '') return;
    const c = customers.find((x) => String(x.id) === value);
    if (!c) return;
    // Fill from the saved record; clear contact fields so a prior customer's
    // contact info doesn't linger.
    setHeader((h) => ({
      ...h,
      customer: c.name,
      customer_address: c.address ?? '',
      customer_contact: '',
      customer_email: '',
      customer_phone: '',
    }));
  }

  function onSelectContact(value: string) {
    setContactId(value);
    if (value === '__other__' || value === '') return;
    const ct = selectedCustomer?.contacts.find((x) => String(x.id) === value);
    if (!ct) return;
    setHeader((h) => ({
      ...h,
      customer_contact: ct.name,
      customer_email: ct.email ?? '',
      customer_phone: ct.phone ?? '',
    }));
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
    const { items, viewPdf } = savePrompt;
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
    await doSave(viewPdf);
  }

  /** Dismiss the prompt without saving any prices, then finish the save. */
  async function skipSavePrompt() {
    if (!savePrompt) return;
    const { viewPdf } = savePrompt;
    setSavePrompt(null);
    await doSave(viewPdf);
  }

  // Existing quotes store both kinds in one list; split them for editing. Rows
  // without an explicit kind predate the split and were customer-facing.
  const existingPricing = (quote?.line_items ?? []).filter((li) => li.kind === 'pricing');
  const existingDisplay = (quote?.line_items ?? []).filter((li) => li.kind !== 'pricing');

  const [pricingRows, setPricingRows] = useState<PricingRow[]>(
    existingPricing.length
      ? existingPricing.map((li) => ({
          description: li.description,
          quantity: String(li.quantity),
          unit: li.unit ?? '',
          unit_price: String(li.unit_price),
        }))
      : [blankPricingRow()]
  );
  const [displayRows, setDisplayRows] = useState<DisplayRow[]>(
    existingDisplay.length
      ? existingDisplay.map((li) => ({
          // Normalize to editor HTML so legacy plain-text (with newlines) and
          // any stored formatting both load into the rich-text editor cleanly.
          description: sanitizeRichText(li.description),
          // Fall back to quantity × unit price for pre-split quotes with no amount.
          amount: String(li.amount ?? li.quantity * li.unit_price),
        }))
      : [blankDisplayRow()]
  );

  const set = (k: keyof typeof header) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setHeader((h) => ({ ...h, [k]: e.target.value }));

  const pricingSubtotal = useMemo(
    () => pricingRows.reduce((s, r) => s + num(r.quantity) * num(r.unit_price), 0),
    [pricingRows]
  );

  const totals = useMemo(() => {
    const subtotal = displayRows.reduce((s, r) => s + num(r.amount), 0);
    // Markup is applied to the subtotal first; tax is charged on the marked-up
    // amount. Markup is folded into line prices on the PDF, so it never shows as
    // its own line to the customer even though it raises the total.
    const markup = subtotal * (num(markupPercent) / 100);
    const taxable = subtotal + markup;
    const tax = taxable * (num(taxPercent) / 100);
    return { subtotal, markup, taxable, tax, total: taxable + tax };
  }, [displayRows, taxPercent, markupPercent]);

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
  /** Copy the internal pricing subtotal into a new customer line. */
  function pricingToLine() {
    setDisplayRows((rs) => [
      ...rs.filter((r) => r.description.trim() || r.amount.trim()),
      { description: header.project_name || 'Project total', amount: pricingSubtotal.toFixed(2) },
    ]);
  }

  /* ---- display rows ---- */
  function updateDisplay(i: number, patch: Partial<DisplayRow>) {
    setDisplayRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  const addDisplay = () => setDisplayRows((rs) => [...rs, blankDisplayRow()]);
  const removeDisplay = (i: number) =>
    setDisplayRows((rs) => (rs.length === 1 ? rs : rs.filter((_, idx) => idx !== i)));
  function moveDisplay(i: number, dir: -1 | 1) {
    setDisplayRows((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }

  /**
   * Save entry point. Validates, then — if the worksheet has prices not yet in
   * the book — opens the single "add to pricing list?" prompt before saving.
   * Otherwise it saves straight away.
   */
  function save(viewPdf: boolean) {
    setError(null);
    if (!header.customer.trim()) {
      setError('Customer is required.');
      return;
    }
    const newItems = collectNewPricingItems();
    if (newItems.length > 0) {
      // Default every candidate to checked — the common case is "yes, save these".
      setSelectedNew(new Set(newItems.map((_, i) => i)));
      setSavePrompt({ items: newItems, viewPdf });
      return;
    }
    void doSave(viewPdf);
  }

  async function doSave(viewPdf: boolean) {
    setError(null);
    if (!header.customer.trim()) {
      setError('Customer is required.');
      return;
    }
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
        })),
      ...displayRows
        .filter((r) => !isRichTextEmpty(r.description))
        .map<LineItemInput>((r) => ({
          kind: 'display',
          description: r.description,
          quantity: 1,
          unit: null,
          unit_price: 0,
          amount: num(r.amount),
        })),
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
      tax_rate: num(taxPercent) / 100,
      markup_rate: num(markupPercent) / 100,
      terms: header.terms || null,
      notes: header.notes || null,
      prepared_by: header.prepared_by || null,
      items,
    };
    setSaving(true);
    try {
      const res = quote
        ? await updateQuoteDocAction(quote.id, payload, viewPdf)
        : await createQuoteDocAction(payload, viewPdf);
      // A successful action redirects server-side; only errors return here.
      if (res?.error) {
        setError(res.error);
        setSaving(false);
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

  return (
    <div className="space-y-6">
      {/* Customer / project details */}
      <div className="card p-5">
        <h2 className="brand-heading mb-4 text-sm text-brand-ink">Customer &amp; Project</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Customer *</label>
            {customers.length > 0 && (
              <select className="input" value={customerId} onChange={(e) => onSelectCustomer(e.target.value)}>
                <option value="">Select a saved customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
                <option value="__other__">Other / one-off…</option>
              </select>
            )}
            {(customers.length === 0 || customerId === '__other__') && (
              <input
                className={`input ${customers.length > 0 ? 'mt-2' : ''}`}
                value={header.customer}
                onChange={set('customer')}
                placeholder="ARH-Highlands"
              />
            )}
            {customers.length > 0 && (
              <p className="mt-1 text-xs text-brand-gray">
                Manage saved customers under Settings → Customers.
              </p>
            )}
          </div>
          <div>
            <label className="label">Contact Name</label>
            {selectedCustomer && selectedCustomer.contacts.length > 0 && (
              <select className="input mb-2" value={contactId} onChange={(e) => onSelectContact(e.target.value)}>
                <option value="">Select a saved contact…</option>
                {selectedCustomer.contacts.map((ct) => (
                  <option key={ct.id} value={String(ct.id)}>
                    {ct.name}
                    {ct.title ? ` — ${ct.title}` : ''}
                  </option>
                ))}
                <option value="__other__">Other…</option>
              </select>
            )}
            <input className="input" value={header.customer_contact} onChange={set('customer_contact')} placeholder="Jane Doe" />
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
            <label className="label">Project / Description</label>
            <input className="input" value={header.project_name} onChange={set('project_name')} placeholder="Corridor Flooring Replacement" />
          </div>
          <div>
            <label className="label">Project Location</label>
            <input className="input" value={header.project_location} onChange={set('project_location')} placeholder="Building B, 2nd floor" />
          </div>
          <div>
            <label className="label">Category</label>
            <input className="input" value={header.category} onChange={set('category')} list="qb-categories" placeholder="Flooring" />
            <datalist id="qb-categories">
              {CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
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
            <label className="label">Quote #</label>
            <input className="input" value={header.quote_number} onChange={set('quote_number')} placeholder="Q-2601" />
          </div>
          <div>
            <label className="label">Issue Date</label>
            <input className="input" type="date" value={header.issue_date} onChange={set('issue_date')} />
          </div>
          <div>
            <label className="label">Valid Until</label>
            <input className="input" type="date" value={header.valid_until} onChange={set('valid_until')} />
          </div>
        </div>
      </div>

      {/* Customer-facing line items — shown on the PDF */}
      <div className="card p-5">
        <h2 className="brand-heading mb-1 text-sm text-brand-ink">Line Items</h2>
        <p className="mb-4 text-xs text-brand-gray">
          What the customer sees on the quote — a description and a total price per line.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-black/5 text-left text-xs uppercase tracking-wide text-brand-gray">
                <th className="px-2 py-2 font-semibold">Description</th>
                <th className="px-2 py-2 text-right font-semibold w-40">Price</th>
                <th className="px-2 py-2 w-24" />
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r, i) => (
                <tr key={i} className="border-b border-black/5 last:border-0 align-top">
                  <td className="px-2 py-2">
                    <RichTextEditor
                      value={r.description}
                      onChange={(html) => updateDisplay(i, { description: html })}
                      placeholder="Furnish and install new carpet tile throughout corridor …"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      className="input text-right"
                      inputMode="decimal"
                      value={r.amount}
                      onChange={(e) => updateDisplay(i, { amount: e.target.value })}
                      placeholder="0.00"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-1 text-brand-gray">
                      <button type="button" aria-label="Move up" className="rounded p-1 hover:bg-black/5 disabled:opacity-30" onClick={() => moveDisplay(i, -1)} disabled={i === 0}>↑</button>
                      <button type="button" aria-label="Move down" className="rounded p-1 hover:bg-black/5 disabled:opacity-30" onClick={() => moveDisplay(i, 1)} disabled={i === displayRows.length - 1}>↓</button>
                      <button type="button" aria-label="Remove" className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-30" onClick={() => removeDisplay(i)} disabled={displayRows.length === 1}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          className="mt-2 w-full rounded-lg border border-dashed border-black/15 py-2 text-sm font-medium text-brand-gray hover:border-brand-green hover:text-brand-green"
          onClick={addDisplay}
        >
          + Add Line
        </button>

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <div className="w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-brand-gray">Subtotal</span>
              <span className="font-semibold text-brand-ink">{money(totals.subtotal, { cents: true })}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-brand-gray">
                Markup
                <input
                  className="input ml-2 inline-block w-16 px-2 py-1"
                  inputMode="decimal"
                  value={markupPercent}
                  onChange={(e) => setMarkupPercent(e.target.value)}
                />
                <span className="ml-1">%</span>
              </span>
              <span className="font-semibold text-brand-ink">{money(totals.markup, { cents: true })}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-brand-gray">
                Tax
                <input
                  className="input ml-2 inline-block w-16 px-2 py-1"
                  inputMode="decimal"
                  value={taxPercent}
                  onChange={(e) => setTaxPercent(e.target.value)}
                />
                <span className="ml-1">%</span>
              </span>
              <span className="font-semibold text-brand-ink">{money(totals.tax, { cents: true })}</span>
            </div>
            <div className="flex justify-between border-t border-black/10 pt-2 text-base">
              <span className="font-semibold text-brand-ink">Total</span>
              <span className="font-bold text-brand-ink">{money(totals.total, { cents: true })}</span>
            </div>
            {num(markupPercent) > 0 && (
              <p className="pt-1 text-xs text-brand-gray">
                Markup is spread across line prices on the customer PDF — it raises the total but
                isn&apos;t shown as its own line.
              </p>
            )}
          </div>
        </div>
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
              price from the Description dropdown, or type your own — when you save the quote you&apos;ll be asked whether
              to add any new prices to your pricing list. Then enter what the customer sees in Line Items above.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-black/5 text-left text-xs uppercase tracking-wide text-brand-gray">
                    <th className="px-2 py-2 font-semibold">Description</th>
                    <th className="px-2 py-2 font-semibold w-20">Qty</th>
                    <th className="px-2 py-2 font-semibold w-24">Unit</th>
                    <th className="px-2 py-2 font-semibold w-32">Unit Price</th>
                    <th className="px-2 py-2 text-right font-semibold w-28">Amount</th>
                    <th className="px-2 py-2 w-24" />
                  </tr>
                </thead>
                <tbody>
                  {pricingRows.map((r, i) => (
                    <tr key={i} className="border-b border-black/5 last:border-0 align-top">
                      <td className="px-2 py-2">
                        <input
                          className="input"
                          list="qb-pricebook"
                          value={r.description}
                          onChange={(e) => applyPriceBook(i, e.target.value)}
                          placeholder="Carpet tile, adhesive, labor …"
                        />
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
        <h2 className="brand-heading mb-4 text-sm text-brand-ink">Terms &amp; Notes</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Terms &amp; Conditions</label>
            <textarea className="input" rows={4} value={header.terms} onChange={set('terms')} placeholder="Payment due within 30 days. Pricing valid for 30 days." />
          </div>
          <div>
            <label className="label">Notes (shown on quote)</label>
            <textarea className="input" rows={4} value={header.notes} onChange={set('notes')} placeholder="Anything the customer should know." />
          </div>
        </div>
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

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => router.push('/quotes')} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="btn-secondary" onClick={() => save(false)} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn-primary" onClick={() => save(true)} disabled={saving}>
          {saving ? 'Saving…' : quote ? 'Save & View PDF' : 'Create & View PDF'}
        </button>
      </div>
    </div>
  );
}
