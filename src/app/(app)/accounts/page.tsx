import { AccountRow, NewAccountForm } from "@/components/account-manager";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const user = await requireUser();
  const accounts = await db.account.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    include: { _count: { select: { trades: true } } },
  });
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Accounts</h1>
        <p className="mt-1 text-sm text-muted">One per broker account or strategy bucket. New trades default to the default account.</p>
      </div>
      <section className="card card-pad">
        <h2 className="mb-3 text-sm font-semibold">New account</h2>
        <NewAccountForm />
      </section>
      <section className="card card-pad">
        <h2 className="text-sm font-semibold">Your accounts</h2>
        {accounts.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No accounts yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {accounts.map((a) => (
              <AccountRow
                key={a.id}
                account={{ id: a.id, name: a.name, broker: a.broker, currency: a.currency, isDefault: a.isDefault, tradeCount: a._count.trades }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
