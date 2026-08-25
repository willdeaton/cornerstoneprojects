'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import {
  createReceiptWithItems,
  updateReceiptWithItems,
  setReceiptImage,
  deleteReceiptImage,
  deleteReceipt,
  receiptBelongsToProject,
} from '@/lib/data';
import { RECEIPT_CATEGORIES, type ReceiptCategory, type ReceiptInput } from '@/lib/types';
import { cents, parseMoney } from '@/lib/receipt-math';
import { money } from '@/lib/format';

/**
 * What a job cost is the other half of what it was sold for, so receipts draw
 * the same line the invoice PDF draws: admins and managers only, not the looser
 * "anyone but an employee" the Files tab settles for.
 *
 * Throws rather than redirects — these are called from client handlers, where a
 * redirect out of a form submission is worse than an error the form can show.
 */
async function requireBiller() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin' && user.role !== 'manager') throw new Error('Not authorized.');
  return user;
}

export interface ReceiptFormState {
  error?: string;
  success?: string;
  /**
   * The paper's own arithmetic doesn't add up. Shown, never enforced — a till
   * roll that rounds oddly is still the receipt, and refusing to save it would
   * just mean the cost never gets recorded at all.
   */
  warning?: string;
}

/** Same ceiling as project files and invoice PDFs. */
const MAX_BYTES = 10_000_000;
/** A receipt with more lines than this is a form being abused, not a purchase. */
const MAX_ITEMS = 200;
/** Above this, somebody has typed cents into the dollars box. */
const MAX_TOTAL = 1_000_000;

const IMAGE_HINT = 'Attach a photo or a PDF of the receipt.';

function textField(v: FormDataEntryValue | null, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

/** A date input gives 'YYYY-MM-DD'; anything else is treated as not filled in. */
function dateField(v: FormDataEntryValue | null): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function categoryField(v: FormDataEntryValue | null): ReceiptCategory {
  return (RECEIPT_CATEGORIES as readonly string[]).includes(String(v))
    ? (v as ReceiptCategory)
    : 'Other';
}

/**
 * Read the line-item repeater out of the form.
 *
 * The rows arrive as four same-named fields repeated once per row, zipped back
 * together by index — the same `getAll` trick the project-file upload uses for
 * multiple files, and it survives a submit without any client-side JSON.
 *
 * This depends on the form rendering ALL FOUR inputs for EVERY row, even the
 * empty ones: skip one input on one row and every later row reads the wrong
 * quantity. ReceiptLineItems carries the matching comment.
 */
function parseItems(formData: FormData): ReceiptInput['items'] {
  const descs = formData.getAll('item_desc').map(String);
  const qtys = formData.getAll('item_qty').map(String);
  const prices = formData.getAll('item_price').map(String);
  const amounts = formData.getAll('item_amount').map(String);

  const items: ReceiptInput['items'] = [];
  for (let i = 0; i < descs.length && items.length < MAX_ITEMS; i++) {
    const description = descs[i].trim().slice(0, 500);
    const quantity = parseMoney(qtys[i]);
    const unit_price = parseMoney(prices[i]);
    const typed = parseMoney(amounts[i]);
    // A row with nothing in it is a row the repeater left behind, not a $0 line.
    if (!description && !quantity && !unit_price && !typed) continue;
    items.push({
      description: description || '(no description)',
      quantity: quantity || 1,
      unit_price,
      // Blank amount falls back to qty x price, the way a quote line does.
      amount: typed || cents((quantity || 1) * unit_price),
    });
  }
  return items;
}

interface ParsedImage {
  filename: string;
  mime: string;
  size: number;
  data: string;
}

async function parseImage(file: File): Promise<ParsedImage> {
  const mime = file.type || 'application/octet-stream';
  const buf = Buffer.from(await file.arrayBuffer());
  return {
    filename: file.name || 'receipt',
    mime,
    size: file.size,
    data: `data:${mime};base64,${buf.toString('base64')}`,
  };
}

function isAcceptableImage(file: File): boolean {
  const mime = file.type || '';
  return mime.startsWith('image/') || mime === 'application/pdf';
}

/**
 * The browser-made thumbnail that rides along with the photo.
 *
 * Optional by design: a PDF has none, and neither does an image the browser
 * couldn't decode. Missing simply means the table draws a file tile.
 */
async function parseThumb(formData: FormData): Promise<string | null> {
  const thumb = formData.get('image_thumb');
  if (!(thumb instanceof File) || thumb.size === 0) return null;
  // A thumbnail this big isn't one; ignore it rather than storing it.
  if (thumb.size > 500_000) return null;
  const buf = Buffer.from(await thumb.arrayBuffer());
  return `data:${thumb.type || 'image/jpeg'};base64,${buf.toString('base64')}`;
}

/**
 * Save a receipt — one action for both adding and editing.
 *
 * A `receipt_id` on the form means edit; its absence means add. One action
 * rather than two because the form is one component either way, and the
 * validation, the money parsing and the photo handling are identical.
 *
 * The photo is optional in both directions: a receipt can be a photo with
 * nothing typed yet, or typed figures with the paper long gone.
 */
export async function saveReceiptAction(
  _prev: ReceiptFormState,
  formData: FormData
): Promise<ReceiptFormState> {
  const user = await requireBiller();

  const projectId = Number(formData.get('project_id'));
  if (!projectId) return { error: 'Missing project.' };

  const receiptId = Number(formData.get('receipt_id')) || 0;
  if (receiptId && !(await receiptBelongsToProject(receiptId, projectId))) {
    return { error: 'That receipt is not on this job.' };
  }

  const vendor = textField(formData.get('vendor'), 200);
  const purchase_date = dateField(formData.get('purchase_date'));
  const category = categoryField(formData.get('category'));
  const note = textField(formData.get('note'), 2000);
  const items = parseItems(formData);

  const subtotalIn = parseMoney(formData.get('subtotal'));
  const taxIn = parseMoney(formData.get('tax'));
  const totalIn = parseMoney(formData.get('total'));

  const file = formData.get('image');
  const hasNewImage = file instanceof File && file.size > 0;
  const removeImage = formData.get('remove_image') === '1';

  // A receipt has to be *something*: a photo, a name, or an amount. All three
  // empty is a mis-click, and saving it would put a blank row on the job.
  if (!hasNewImage && !vendor && !totalIn && items.length === 0 && !receiptId) {
    return { error: `Enter at least a vendor or a total. ${IMAGE_HINT}` };
  }
  if (totalIn > MAX_TOTAL) {
    return { error: `${money(totalIn, { cents: true })} looks like a typo — check the total.` };
  }

  const itemSum = cents(items.reduce((sum, it) => sum + (it.amount ?? 0), 0));
  const subtotal = subtotalIn || itemSum;
  const tax = taxIn;
  // The typed total wins. It is what the paper says, and the job's total has to
  // equal the sum of the receipts in the folder for anyone reconciling it.
  const total = totalIn || cents(subtotal + tax) || itemSum;

  const warning =
    totalIn && (subtotalIn || taxIn) && Math.abs(subtotalIn + taxIn - totalIn) > 0.01
      ? `Subtotal + tax comes to ${money(subtotalIn + taxIn, { cents: true })}, but the ` +
        `total says ${money(totalIn, { cents: true })}. Saved as typed — check it if that's wrong.`
      : undefined;

  const input: ReceiptInput = {
    project_id: projectId,
    vendor,
    purchase_date,
    category,
    subtotal,
    tax,
    total,
    note,
    entry_source: 'manual',
    items,
  };

  // Reject an unusable attachment before writing anything, so a bad file
  // doesn't leave a receipt half-saved on an edit.
  if (hasNewImage && !isAcceptableImage(file)) {
    return { error: 'That file is not a photo or a PDF.' };
  }

  let id = receiptId;
  if (receiptId) {
    await updateReceiptWithItems(receiptId, input);
  } else {
    id = await createReceiptWithItems(input, { user_id: user.id, user_name: user.name });
  }

  // Oversized photo: the typed figures are already saved, so say what was
  // dropped rather than throwing the whole entry away. Same two-field shape
  // the project-file upload uses when it skips a file.
  let imageError: string | undefined;
  if (hasNewImage) {
    if (file.size > MAX_BYTES) {
      imageError =
        'The receipt was saved, but the photo was over 10 MB and was not attached. ' +
        'Try taking it again — the app shrinks photos automatically.';
    } else {
      const img = await parseImage(file);
      await setReceiptImage({
        receipt_id: id,
        ...img,
        thumb: await parseThumb(formData),
        uploaded_by: user.id,
        uploader_name: user.name,
      });
    }
  } else if (removeImage && receiptId) {
    await deleteReceiptImage(receiptId);
  }

  revalidatePath(`/projects/${projectId}`, 'layout');

  const saved = receiptId ? 'Receipt updated.' : 'Receipt saved.';
  if (imageError) return { success: saved, error: imageError };
  return { success: saved, warning };
}

/** Delete a receipt. Its line items and photo go with it, both by cascade. */
export async function deleteReceiptAction(
  receiptId: number,
  projectId: number
): Promise<{ error?: string }> {
  await requireBiller();
  if (!(await receiptBelongsToProject(receiptId, projectId))) {
    return { error: 'That receipt is not on this job.' };
  }
  await deleteReceipt(receiptId);
  revalidatePath(`/projects/${projectId}`, 'layout');
  return {};
}

/** Detach a receipt's photo, leaving the figures alone. */
export async function removeReceiptImageAction(
  receiptId: number,
  projectId: number
): Promise<{ error?: string }> {
  await requireBiller();
  if (!(await receiptBelongsToProject(receiptId, projectId))) {
    return { error: 'That receipt is not on this job.' };
  }
  await deleteReceiptImage(receiptId);
  revalidatePath(`/projects/${projectId}`, 'layout');
  return {};
}
