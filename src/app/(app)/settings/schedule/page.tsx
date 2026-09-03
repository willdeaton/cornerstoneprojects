import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listHolidays } from '@/lib/schedule-data';
import { HolidaysManager } from './HolidaysManager';

export const dynamic = 'force-dynamic';

export default async function ScheduleSettingsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'manager') redirect('/dashboard');

  const holidays = await listHolidays();

  return (
    <div>
      <div className="mb-4">
        <h2 className="brand-heading text-sm text-brand-gray">Non-Working Days</h2>
        <p className="text-sm text-brand-gray">
          Holidays and shutdown days — click them straight off the calendar. Saturdays and Sundays
          are already skipped everywhere; days blocked here are skipped too, so a phase&apos;s
          duration stretches around them and every projected end date moves accordingly. Nobody
          can be booked on a blocked day, and a single day can also be marked off by clicking its
          date on the crew week.
        </p>
      </div>
      <HolidaysManager holidays={holidays} />
    </div>
  );
}
