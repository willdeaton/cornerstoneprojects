import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { QuoteBuilder } from '../QuoteBuilder';

export const dynamic = 'force-dynamic';

export default async function NewQuotePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div>
      <PageHeader title="New Quote" subtitle="Build a customer quote from scratch" />
      <QuoteBuilder />
    </div>
  );
}
