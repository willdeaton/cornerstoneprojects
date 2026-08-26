'use client';

/*
 * Per-user email subscription controls. The checkbox `name`s map 1:1 to the
 * DB boolean columns, so they serialize straight into the user save payload.
 */

export interface SubscriptionDefaults {
  personal_email?: string | null;
  work_email?: string | null;
  receives_new_project_emails?: boolean;
  receives_completion_emails?: boolean;
}

const EMAIL_TYPES: { name: keyof SubscriptionDefaults; label: string; hint: string }[] = [
  {
    name: 'receives_new_project_emails',
    label: 'Sold work',
    hint: 'One email at the end of each day listing the work we won.',
  },
  {
    name: 'receives_completion_emails',
    label: 'Completed jobs',
    hint: 'One email at the end of each day listing the jobs marked complete.',
  },
];

export function SubscriptionFields({ defaults }: { defaults?: SubscriptionDefaults }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Personal Email (optional)</label>
          <input
            name="personal_email"
            type="email"
            className="input"
            defaultValue={defaults?.personal_email ?? ''}
            placeholder="preferred inbox"
          />
        </div>
        <div>
          <label className="label">Work Email (optional)</label>
          <input
            name="work_email"
            type="email"
            className="input"
            defaultValue={defaults?.work_email ?? ''}
            placeholder="falls back to login email"
          />
        </div>
      </div>
      <p className="-mt-1 text-xs text-brand-gray">
        Notifications resolve to Personal → Work → login email.
      </p>

      <div>
        <p className="label">Email subscriptions</p>
        <div className="space-y-2">
          {EMAIL_TYPES.map((t) => (
            <label key={t.name} className="flex items-start gap-2 text-sm text-brand-ink">
              <input
                type="checkbox"
                name={t.name}
                defaultChecked={!!defaults?.[t.name]}
                className="mt-0.5 h-4 w-4 rounded border-black/20 text-brand-green focus:ring-brand-green"
              />
              <span>
                <span className="font-medium">{t.label}</span>
                <span className="block text-xs text-brand-gray">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
