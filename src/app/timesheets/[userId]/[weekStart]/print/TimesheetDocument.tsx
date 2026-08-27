import { Fragment } from 'react';
import type { EmployeeWeekTimesheet } from '@/lib/data';
import type { CompanyInfo } from '@/lib/company';
import { clockTime, money, shortDate } from '@/lib/format';

/**
 * One employee's week on a sheet of paper: the payroll timesheet behind the
 * Print link on each row of the Timesheets review table.
 *
 * Pure and dependency-free (no hooks, no server-only imports) so it renders the
 * same on the server print page as the quote document does — hours in, layout
 * out, nothing fetched here.
 *
 * Every day of the week gets a row whether or not anything was logged: a
 * timesheet's job is to account for the whole week, and a blank Wednesday is
 * information. Days with more than one shift get their own subtotal, since the
 * day is the unit somebody checks against a schedule.
 */

/** 'Mon', 'Tue', … for a YYYY-MM-DD date, read as a plain calendar date. */
function weekday(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
}

/** 'Aug 25' — the year lives in the week range in the header. */
function dayAndMonth(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function hours(n: number): string {
  return n.toFixed(2);
}

export function TimesheetDocument({
  sheet,
  company,
}: {
  sheet: EmployeeWeekTimesheet;
  company: CompanyInfo;
}) {
  const range = `${shortDate(sheet.week_start)} – ${shortDate(sheet.week_end)}`;
  const daysWorked = sheet.days.filter((d) => d.entries.length > 0).length;
  const grossPay = sheet.hourly_rate != null ? sheet.total_hours * sheet.hourly_rate : null;

  return (
    <div
      id="timesheet-document"
      className="mx-auto my-6 max-w-[8.5in] bg-white p-[0.6in] shadow-card print:my-0 print:max-w-none print:p-0 print:shadow-none"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-6 border-b-2 border-brand-green pb-5">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={company.logo}
            alt={company.name}
            className="mb-3 h-14 w-auto max-w-[220px] object-contain"
          />
          <p className="text-sm font-semibold text-brand-ink">{company.name}</p>
          {company.addressLines.map((l) => (
            <p key={l} className="text-xs text-brand-gray">
              {l}
            </p>
          ))}
        </div>
        <div className="text-right">
          <h1 className="brand-heading text-3xl text-brand-ink">Timesheet</h1>
          <p className="mt-1 text-sm text-brand-gray">
            Week of <span className="font-semibold text-brand-ink">{range}</span>
          </p>
          {company.phone && <p className="mt-3 text-xs text-brand-gray">{company.phone}</p>}
          {company.email && <p className="text-xs text-brand-gray">{company.email}</p>}
        </div>
      </div>

      {/* Who and what state the week is in */}
      <div className="mt-6 grid grid-cols-2 gap-8 text-sm">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-gray">
            Employee
          </p>
          <p className="text-base font-semibold text-brand-ink">{sheet.user_name}</p>
          {sheet.manager_name && (
            <p className="text-brand-gray">Reports to {sheet.manager_name}</p>
          )}
        </div>
        <div>
          {/* The week itself is named in the header — this is the state it's in. */}
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-gray">
            Status
          </p>
          <p className="font-semibold text-brand-ink">
            {sheet.approved_at
              ? `Approved${sheet.approved_by_name ? ` by ${sheet.approved_by_name}` : ''} · ${shortDate(sheet.approved_at)}`
              : 'Not yet approved'}
          </p>
          <p className="text-brand-gray">
            {daysWorked} {daysWorked === 1 ? 'day' : 'days'} worked
            {sheet.open_count > 0 &&
              ` · ${sheet.open_count} shift${sheet.open_count === 1 ? '' : 's'} still on the clock`}
          </p>
        </div>
      </div>

      {/* The week, day by day */}
      <table className="mt-5 w-full text-sm">
        <thead>
          <tr className="border-b-2 border-black/10 text-left text-xs uppercase tracking-wide text-brand-gray">
            <th className="py-2 pr-2 font-semibold">Day</th>
            <th className="py-2 pr-2 font-semibold">In</th>
            <th className="py-2 pr-2 font-semibold">Out</th>
            <th className="py-2 pr-2 text-right font-semibold">Break</th>
            <th className="py-2 pr-2 font-semibold">Job</th>
            <th className="py-2 pl-2 text-right font-semibold">Hours</th>
          </tr>
        </thead>
        <tbody>
          {sheet.days.map((day) => {
            if (day.entries.length === 0) {
              return (
                <tr key={day.date} className="border-b border-black/5">
                  <td className="whitespace-nowrap py-1.5 pr-2 font-semibold text-brand-ink">
                    {weekday(day.date)} {dayAndMonth(day.date)}
                  </td>
                  <td className="py-1.5 pr-2 text-brand-gray" colSpan={4}>
                    No hours logged
                  </td>
                  <td className="py-1.5 pl-2 text-right text-brand-gray">{hours(0)}</td>
                </tr>
              );
            }
            return (
              <Fragment key={day.date}>
                {day.entries.map((en, idx) => (
                  <tr key={en.id} className="border-b border-black/5 align-top">
                    <td className="whitespace-nowrap py-1.5 pr-2 font-semibold text-brand-ink">
                      {/* The day is named once, on its first shift. */}
                      {idx === 0 ? `${weekday(day.date)} ${dayAndMonth(day.date)}` : ''}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-2 text-brand-ink">
                      {clockTime(en.clock_in)}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-2 text-brand-ink">
                      {en.clock_out ? clockTime(en.clock_out) : 'On the clock'}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-2 text-right text-brand-gray">
                      {en.break_minutes > 0 ? `${en.break_minutes}m` : '—'}
                    </td>
                    <td className="py-1.5 pr-2 text-brand-ink">
                      {en.project_name ?? 'General (no job)'}
                      {en.customer && (
                        <span className="block text-xs text-brand-gray">{en.customer}</span>
                      )}
                      {en.note && (
                        <span className="block text-xs italic text-brand-gray">{en.note}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pl-2 text-right font-semibold text-brand-ink">
                      {/* An open shift has no net time yet, so it prints blank
                          rather than as a zero that reads like a worked day. */}
                      {en.clock_out ? hours(en.net_hours) : '—'}
                    </td>
                  </tr>
                ))}
                {day.entries.length > 1 && (
                  <tr className="border-b border-black/5">
                    <td className="py-1.5 pr-2" />
                    <td className="py-1.5 pr-2 text-xs text-brand-gray" colSpan={4}>
                      {weekday(day.date)} total
                    </td>
                    <td className="whitespace-nowrap py-1.5 pl-2 text-right text-xs font-semibold text-brand-ink">
                      {hours(day.hours)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {/* Totals */}
      <div className="mt-4 flex justify-end break-inside-avoid">
        <div className="w-72 space-y-1.5 text-sm">
          <div className="flex justify-between border-t-2 border-brand-green pt-2 text-base">
            <span className="font-semibold text-brand-ink">Total hours</span>
            <span className="font-bold text-brand-ink">{hours(sheet.total_hours)}</span>
          </div>
          {sheet.total_break_minutes > 0 && (
            <div className="flex justify-between text-brand-gray">
              <span>Breaks deducted</span>
              <span>{sheet.total_break_minutes}m</span>
            </div>
          )}
          {/* Pay only when there's time to pay for — a blank week's rate
              and a $0.00 gross say nothing worth printing. */}
          {sheet.hourly_rate != null && sheet.total_hours > 0 && (
            <>
              <div className="flex justify-between text-brand-gray">
                <span>Rate</span>
                <span>{money(sheet.hourly_rate, { cents: true })}/hr</span>
              </div>
              <div className="flex justify-between border-t border-black/10 pt-1.5">
                <span className="font-semibold text-brand-ink">Gross pay</span>
                <span className="font-bold text-brand-ink">
                  {money(grossPay ?? 0, { cents: true })}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Pay status — what payroll has and hasn't settled for the week */}
      <div className="mt-5 break-inside-avoid border-t border-black/10 pt-4 text-sm">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-gray">
          Pay Status
        </p>
        <p className="text-brand-ink">
          {sheet.total_hours === 0
            ? 'No closed shifts this week.'
            : sheet.unpaid_hours === 0
              ? `Paid in full — ${hours(sheet.paid_hours)} hours`
              : sheet.paid_hours === 0
                ? `Unpaid — ${hours(sheet.unpaid_hours)} hours`
                : `${hours(sheet.paid_hours)} hours paid · ${hours(sheet.unpaid_hours)} hours unpaid`}
          {sheet.check_number && ` · Check #${sheet.check_number}`}
        </p>
      </div>

      {/* Sign-off — the reason a timesheet gets printed at all */}
      <div className="mt-6 break-inside-avoid border-t border-black/10 pt-4 text-sm text-brand-ink">
        <p className="mb-4 font-semibold">
          I certify the hours above are a true record of the time I worked.
        </p>
        <div className="grid grid-cols-2 gap-x-12 gap-y-7">
          <div className="flex items-end gap-2">
            <span className="whitespace-nowrap">Employee:</span>
            <span className="flex-1 border-b border-brand-ink" />
          </div>
          <div className="flex items-end gap-2">
            <span className="whitespace-nowrap">Date:</span>
            <span className="flex-1 border-b border-brand-ink" />
          </div>
          <div className="flex items-end gap-2">
            <span className="whitespace-nowrap">Supervisor:</span>
            <span className="flex-1 border-b border-brand-ink" />
          </div>
          <div className="flex items-end gap-2">
            <span className="whitespace-nowrap">Date:</span>
            <span className="flex-1 border-b border-brand-ink" />
          </div>
        </div>
      </div>
    </div>
  );
}
