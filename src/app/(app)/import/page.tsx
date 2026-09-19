import Link from "next/link";
import { undoImportBatchAction } from "@/actions/imports";
import { ConfirmSubmit } from "@/components/confirm-button";
import { ImportWizard, type ImportPresetDTO } from "@/components/import-wizard";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Import" };

export default async function ImportPage() {
  const user = await requireUser();
  const [accounts, presetRows, batches] = await Promise.all([
    db.account.findMany({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    db.importPreset.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    db.importBatch.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 25, include: { _count: { select: { trades: true } } } }),
  ]);
  const presets = presetRows.map((p) => ({ id: p.id, name: p.name, mapping: p.mapping as ImportPresetDTO["mapping"], options: p.options as ImportPresetDTO["options"] }));
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="page-title">Import trades</h1>
        <p className="mt-1 text-sm text-muted">Bring in a broker export or a spreadsheet. Nothing is saved until you press Import, and every import can be undone.</p>
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
          presets={presets}
        />
      )}

      <section className="card card-pad" aria-label="Import history">
        <h2 className="mb-1 text-sm font-semibold">Import history</h2>
        <p className="mb-3 text-xs text-muted">The last 25 imports. Undoing one deletes the trades it created, with their screenshots and rule events.</p>
        {batches.length === 0 ? (
          <p className="text-sm text-muted">No imports yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2" aria-label={`Import ${b.filename}`}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="truncate">{b.filename}</span>
                    <span className="badge">{b.mode === "EXECUTIONS" ? "Executions" : "Trades"}</span>
                  </p>
                  <p className="num text-xs text-muted">
                    {formatDateTime(b.createdAt, user.timeZone)} · {b.inserted} inserted · {b.skipped} skipped · {b.errors} row error{b.errors === 1 ? "" : "s"} ·{" "}
                    {b._count.trades} still in the journal
                  </p>
                </div>
                <form action={undoImportBatchAction.bind(null, b.id)}>
                  <ConfirmSubmit
                    message={`Undo the import of ${b.filename}? The ${b._count.trades} trade${b._count.trades === 1 ? "" : "s"} it created ${b._count.trades === 1 ? "is" : "are"} deleted with their screenshots and rule events. This cannot be undone.`}
                    className="btn btn-sm btn-danger"
                  >
                    Undo import
                  </ConfirmSubmit>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
