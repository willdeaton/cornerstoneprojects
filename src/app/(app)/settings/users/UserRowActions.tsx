'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@/lib/auth';
import type { UserRow } from '@/lib/data';
import { Modal } from '@/components/Modal';
import { DropdownMenu } from '@/components/DropdownMenu';
import {
  changeRoleAction,
  toggleActiveAction,
  resetPasswordAction,
  setUserRateAction,
  setUserSchedulableAction,
  updateUserSubscriptionsAction,
  deleteUserAction,
  setUserManagerAction,
} from '@/app/actions/users';
import { SubscriptionFields } from './SubscriptionFields';

export function UserRowActions({
  user,
  isSelf,
  canGrantAdmin,
  managers,
}: {
  user: UserRow;
  isSelf: boolean;
  canGrantAdmin: boolean;
  managers: { id: number; name: string }[];
}) {
  const [pwOpen, setPwOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [subsOpen, setSubsOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [mgrOpen, setMgrOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [mgrId, setMgrId] = useState(user.manager_id != null ? String(user.manager_id) : '');
  const [rate, setRate] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [rateMsg, setRateMsg] = useState<string | null>(null);
  const [delMsg, setDelMsg] = useState<string | null>(null);
  const [mgrMsg, setMgrMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const roles: Role[] = canGrantAdmin
    ? ['employee', 'worker', 'manager', 'admin']
    : ['employee', 'worker', 'manager'];

  function run(fn: () => Promise<unknown>) {
    start(async () => {
      await fn();
      router.refresh();
    });
  }

  function submitPw() {
    start(async () => {
      const res = await resetPasswordAction(user.id, pw);
      if (res && !res.ok) {
        setMsg(res.error ?? 'Could not reset password.');
      } else {
        setPwOpen(false);
        setPw('');
        setMsg(null);
        router.refresh();
      }
    });
  }

  function submitManager() {
    start(async () => {
      const res = await setUserManagerAction(user.id, mgrId ? Number(mgrId) : null);
      if (res && !res.ok) {
        setMgrMsg(res.error ?? 'Could not change manager.');
      } else {
        setMgrOpen(false);
        setMgrMsg(null);
        router.refresh();
      }
    });
  }

  function submitRate() {
    start(async () => {
      const res = await setUserRateAction(user.id, rate);
      if (res && !res.ok) {
        setRateMsg(res.error ?? 'Could not update hourly rate.');
      } else {
        setRateOpen(false);
        setRateMsg(null);
        router.refresh();
      }
    });
  }

  function submitDelete() {
    start(async () => {
      const res = await deleteUserAction(user.id);
      if (res && !res.ok) {
        setDelMsg(res.error ?? 'Could not delete user.');
      } else {
        setDelOpen(false);
        setDelMsg(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      <DropdownMenu width={192} disabled={pending}>
        {(close) => (
          <>
            <p className="menu-label">
              Set role
            </p>
            {roles.map((r) => (
              <button
                key={r}
                disabled={r === user.role}
                className="menu-item capitalize disabled:font-semibold disabled:text-brand-green-dark"
                onClick={() => {
                  close();
                  run(() => changeRoleAction(user.id, r));
                }}
              >
                {r}
                {r === user.role ? ' ✓' : ''}
              </button>
            ))}
            <div className="menu-sep" />
            <button
              className="menu-item"
              onClick={() => {
                close();
                setMgrId(user.manager_id != null ? String(user.manager_id) : '');
                setMgrMsg(null);
                setMgrOpen(true);
              }}
            >
              Change manager
            </button>
            <button
              className="menu-item"
              onClick={() => {
                close();
                setPwOpen(true);
              }}
            >
              Reset password
            </button>
            <button
              className="menu-item"
              onClick={() => {
                close();
                setRate(user.hourly_rate != null ? String(user.hourly_rate) : '');
                setRateMsg(null);
                setRateOpen(true);
              }}
            >
              Set hourly rate
            </button>
            <button
              className="menu-item"
              onClick={() => {
                close();
                setSubsOpen(true);
              }}
            >
              Email subscriptions
            </button>
            <div className="menu-sep" />
            {/* Scheduling is separate from access on purpose: somebody can use
                the tracker and clock in without ever being crew the schedule
                books. Days they're already on are left where they are. */}
            {user.schedulable ? (
              <button
                className="menu-item"
                title={`Stop the crew week offering ${user.name} — days they are already booked on stay booked`}
                onClick={() => {
                  close();
                  run(() => setUserSchedulableAction(user.id, false));
                }}
              >
                Remove from scheduling
              </button>
            ) : (
              <button
                className="menu-item-accent"
                title={`Let the crew week book ${user.name} again`}
                onClick={() => {
                  close();
                  run(() => setUserSchedulableAction(user.id, true));
                }}
              >
                Add back to scheduling
              </button>
            )}
            {!isSelf &&
              (user.active ? (
                <button
                  className="menu-item-danger"
                  onClick={() => {
                    close();
                    run(() => toggleActiveAction(user.id, false));
                  }}
                >
                  Deactivate
                </button>
              ) : (
                <button
                  className="menu-item-accent"
                  onClick={() => {
                    close();
                    run(() => toggleActiveAction(user.id, true));
                  }}
                >
                  Reactivate
                </button>
              ))}
            {!isSelf && (
              <>
                <div className="menu-sep" />
                <button
                  className="menu-item-danger"
                  onClick={() => {
                    close();
                    setDelMsg(null);
                    setDelOpen(true);
                  }}
                >
                  Delete user
                </button>
              </>
            )}
          </>
        )}
      </DropdownMenu>

      <Modal open={mgrOpen} onClose={() => setMgrOpen(false)} title={`Change manager — ${user.name}`}>
        <div className="space-y-4">
          <div>
            <label className="label">Manager</label>
            <select className="input" value={mgrId} onChange={(e) => setMgrId(e.target.value)}>
              <option value="">— No manager —</option>
              {/* Current manager who is no longer an eligible candidate (deactivated
                  or demoted) — shown so the select reflects reality; picking someone
                  else or "No manager" clears them. */}
              {user.manager_id != null && !managers.some((m) => m.id === user.manager_id) && (
                <option value={user.manager_id}>{user.manager_name ?? 'Unknown'} (current)</option>
              )}
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-brand-gray">
            Who {user.name} reports to. Used for weekly time approvals.
          </p>
          {mgrMsg && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{mgrMsg}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setMgrOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={submitManager} disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={pwOpen} onClose={() => setPwOpen(false)} title={`Reset password — ${user.name}`}>
        <div className="space-y-4">
          <div>
            <label className="label">New Password</label>
            <input
              className="input"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="min 6 characters"
              autoFocus
            />
          </div>
          <p className="text-xs text-brand-gray">
            The user will be signed out of any active sessions and must use the new password.
          </p>
          {msg && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setPwOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={submitPw} disabled={pending || pw.length < 6}>
              {pending ? 'Saving…' : 'Set Password'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={rateOpen} onClose={() => setRateOpen(false)} title={`Hourly rate — ${user.name}`}>
        <div className="space-y-4">
          <div>
            <label className="label">Hourly rate ($/hr)</label>
            <input
              className="input"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="e.g. 22.50"
              autoFocus
            />
          </div>
          <p className="text-xs text-brand-gray">
            Used to calculate the weekly check amount on Timesheets (net hours × rate). Leave blank
            to clear the rate.
          </p>
          {rateMsg && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{rateMsg}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setRateOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={submitRate} disabled={pending}>
              {pending ? 'Saving…' : 'Save Rate'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={subsOpen}
        onClose={() => setSubsOpen(false)}
        title={`Email subscriptions — ${user.name}`}
      >
        <form
          action={(fd) => {
            start(async () => {
              await updateUserSubscriptionsAction({}, fd);
              setSubsOpen(false);
              router.refresh();
            });
          }}
          className="space-y-4"
        >
          <input type="hidden" name="id" value={user.id} />
          <SubscriptionFields
            defaults={{
              personal_email: user.personal_email,
              work_email: user.work_email,
              receives_new_project_emails: user.receives_new_project_emails,
              receives_completion_emails: user.receives_completion_emails,
            }}
          />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={() => setSubsOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={delOpen} onClose={() => setDelOpen(false)} title={`Delete user — ${user.name}`}>
        <div className="space-y-4">
          <p className="text-sm text-brand-ink">
            This permanently removes <span className="font-semibold">{user.name}</span> and all of
            their time entries. This cannot be undone.
          </p>
          <p className="text-xs text-brand-gray">
            To keep their history for reporting, use <span className="font-semibold">Deactivate</span>{' '}
            instead — that blocks access while preserving past clock-ins.
          </p>
          {delMsg && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{delMsg}</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setDelOpen(false)}>
              Cancel
            </button>
            <button
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              onClick={submitDelete}
              disabled={pending}
            >
              {pending ? 'Deleting…' : 'Delete User'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
