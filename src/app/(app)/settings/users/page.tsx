import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listUsers } from '@/lib/data';
import { shortDate } from '@/lib/format';
import { AddUserButton } from './AddUserButton';
import { UserRowActions } from './UserRowActions';

export const dynamic = 'force-dynamic';

const ROLE_BADGE: Record<string, string> = {
  admin: 'bg-brand-green/20 text-brand-green-dark',
  manager: 'bg-blue-100 text-blue-800',
  worker: 'bg-gray-100 text-gray-700',
  employee: 'bg-purple-100 text-purple-800',
};

export default async function UsersPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'manager') redirect('/dashboard');

  const users = await listUsers();

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="brand-heading text-sm text-brand-gray">Users</h2>
          <p className="text-sm text-brand-gray">Manage who can access the tracker and clock in.</p>
        </div>
        <AddUserButton canGrantAdmin={me.role === 'admin'} />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-black/5 text-left text-xs uppercase tracking-wide text-brand-gray">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Added</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-black/5 last:border-0">
                  <td className="px-4 py-3 font-semibold text-brand-ink">
                    {u.name}
                    {u.id === me.id && <span className="ml-2 text-xs font-normal text-brand-gray">(you)</span>}
                  </td>
                  <td className="px-4 py-3 text-brand-gray">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`badge capitalize ${ROLE_BADGE[u.role]}`}>{u.role}</span>
                  </td>
                  <td className="px-4 py-3">
                    {u.active ? (
                      <span className="text-brand-green-dark">Active</span>
                    ) : (
                      <span className="text-brand-gray">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-brand-gray">{shortDate(u.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <UserRowActions
                      user={u}
                      isSelf={u.id === me.id}
                      canGrantAdmin={me.role === 'admin'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
