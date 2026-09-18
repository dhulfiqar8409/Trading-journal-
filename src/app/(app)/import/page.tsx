import Link from "next/link";
import { ImportWizard } from "@/components/import-wizard";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Import" };

export default async function ImportPage() {
  const user = await requireUser();
  const accounts = await db.account.findMany({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="page-title">Import trades</h1>
        <p className="mt-1 text-sm text-muted">Bring in a broker export or a spreadsheet. Nothing is saved until you press Import.</p>
      </div>
      {accounts.length === 0 ? (
        <div className="card card-pad text-sm text-muted">
          Create an account first under{" "}
          <Link href="/accounts" className="text-accent underline">
            Accounts
          </Link>
          .
        </div>
      ) : (
        <ImportWizard
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, isDefault: a.isDefault }))}
          timeZone={user.timeZone}
        />
      )}
    </div>
  );
}
