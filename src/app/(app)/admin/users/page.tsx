import { CreateUserForm, UserList, type AdminUserDTO } from "@/components/user-admin";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Users" };

/** Admin only: the accounts on this server. Journal data stays private to each account. */
export default async function UsersPage() {
  const admin = await requireAdmin();
  const rows = await db.user.findMany({
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      mustChangePassword: true,
      lastLoginAt: true,
      createdAt: true,
      _count: { select: { trades: true } },
    },
  });
  const users: AdminUserDTO[] = rows.map((u) => ({
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    lastLogin: u.lastLoginAt ? formatDateTime(u.lastLoginAt, admin.timeZone) : null,
    created: formatDateTime(u.createdAt, admin.timeZone),
    tradeCount: u._count.trades,
  }));
  const active = users.filter((u) => u.isActive).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="page-title">Users</h1>
        <p className="mt-1 text-sm text-muted">
          {users.length} account{users.length === 1 ? "" : "s"}, {active} active. Each account sees only its own journal; you manage who can sign in.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
        <section className="card card-pad" aria-labelledby="create-user">
          <h2 id="create-user" className="mb-1 text-sm font-semibold">
            Create a user
          </h2>
          <p className="mb-3 text-sm text-muted">They sign in with the temporary password and must replace it right away.</p>
          <CreateUserForm />
        </section>
        <section aria-labelledby="user-list" className="min-w-0">
          <h2 id="user-list" className="mb-2 text-sm font-semibold">
            Accounts
          </h2>
          <UserList users={users} currentUserId={admin.id} />
        </section>
      </div>
    </div>
  );
}
