'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
  createContact,
  updateContact,
  deleteContact,
  createPricingItem,
  updatePricingItem,
  deletePricingItem,
} from '@/lib/data';

/** Result of a save/delete action. */
export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function requireManager() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin' && user.role !== 'manager') {
    throw new Error('Not authorized.');
  }
  return user;
}

/** Trim to a non-empty string, or null. */
function clean(v: unknown): string | null {
  const t = (v ?? '').toString().trim();
  return t === '' ? null : t;
}

/** Postgres unique-violation (duplicate customer name). */
function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505';
}

/* -------------------------------------------------------------- Customers */

export interface CustomerFields {
  id?: number;
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

export async function saveCustomerAction(input: CustomerFields): Promise<ActionResult> {
  await requireManager();
  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, error: 'Customer name is required.' };
  const payload = {
    name,
    address: clean(input.address),
    phone: clean(input.phone),
    email: clean(input.email),
    notes: clean(input.notes),
  };
  try {
    if (input.id) await updateCustomer(input.id, payload);
    else await createCustomer(payload);
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: 'A customer with that name already exists.' };
    throw err;
  }
  revalidatePath('/settings/customers');
  return { ok: true };
}

export async function deleteCustomerAction(id: number): Promise<ActionResult> {
  await requireManager();
  await deleteCustomer(id);
  revalidatePath('/settings/customers');
  return { ok: true };
}

/* ------------------------------------------------------- Customer contacts */

export interface ContactFields {
  id?: number;
  customer_id: number;
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
}

export async function saveContactAction(input: ContactFields): Promise<ActionResult> {
  await requireManager();
  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, error: 'Contact name is required.' };
  const fields = {
    name,
    title: clean(input.title),
    email: clean(input.email),
    phone: clean(input.phone),
  };
  if (input.id) {
    await updateContact(input.id, fields);
  } else {
    if (!input.customer_id) return { ok: false, error: 'Missing customer.' };
    await createContact({ customer_id: input.customer_id, ...fields });
  }
  revalidatePath('/settings/customers');
  return { ok: true };
}

export async function deleteContactAction(id: number): Promise<ActionResult> {
  await requireManager();
  await deleteContact(id);
  revalidatePath('/settings/customers');
  return { ok: true };
}

/* --------------------------------------------------------- Pricing items */

export interface PricingFields {
  id?: number;
  description: string;
  unit?: string | null;
  unit_price: number;
  category?: string | null;
}

export async function savePricingItemAction(input: PricingFields): Promise<ActionResult> {
  await requireManager();
  const description = (input.description ?? '').trim();
  if (!description) return { ok: false, error: 'Description is required.' };
  const price = Number(input.unit_price);
  const payload = {
    description,
    unit: clean(input.unit),
    unit_price: Number.isFinite(price) ? Math.max(0, price) : 0,
    category: clean(input.category),
  };
  if (input.id) await updatePricingItem(input.id, payload);
  else await createPricingItem(payload);
  revalidatePath('/settings/pricing');
  return { ok: true };
}

export async function deletePricingItemAction(id: number): Promise<ActionResult> {
  await requireManager();
  await deletePricingItem(id);
  revalidatePath('/settings/pricing');
  return { ok: true };
}
