import Link from "next/link";
import { createTradeAction } from "@/actions/trades";
import { TradeForm } from "@/components/trade-form";
import { requireUser } from "@/lib/auth";
import { attachmentQuotaBytes, formatMegabytes } from "@/lib/attachments";
import { db } from "@/lib/db";
import { loadCapturePrefill, loadDraft } from "@/lib/queries/capture";
import { usedAttachmentBytes } from "@/lib/queries/storage";
import { loadBudget } from "@/lib/queries/today";
import { serializeRule, serializeTag } from "@/lib/serialize";
import { dateKeyInZone, toDateTimeLocalValue } from "@/lib/tz";

export const metadata = { title: "New trade" };

export default async function NewTradePage({ searchParams }: { searchParams: Promise<{ draft?: string; note?: string; notice?: string }> }) {
  const user = await requireUser();
  const { draft: draftId, note, notice } = await searchParams;
  const [accounts, tags, customRules, budget, capture, draft, usedBytes] = await Promise.all([
    db.account.findMany({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    db.tag.findMany({ where: { userId: user.id }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    db.rule.findMany({ where: { userId: user.id, active: true, kind: "CUSTOM" }, orderBy: { createdAt: "asc" } }),
    loadBudget(user.id, user.timeZone, dateKeyInZone(new Date(), user.timeZone)),
    loadCapturePrefill(user.id),
    loadDraft(user.id, draftId),
    notice === "storage" ? usedAttachmentBytes(user.id) : Promise.resolve(0),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/trades" className="text-sm text-muted hover:text-ink">
          ← Trades
        </Link>
        <h1 className="page-title mt-1">New trade</h1>
        <p className="mt-1 text-sm text-muted">
          {capture.prefill ? `Prefilled from your last ${capture.prefill.symbol} trade. ` : ""}One tap saves it; details can wait.
        </p>
      </div>
      {notice === "storage" ? (
        <p role="alert" className="rounded-lg border border-loss-mark/40 bg-loss-soft px-3 py-2 text-sm text-loss">
          The shared screenshot was not saved: storage limit reached ({formatMegabytes(usedBytes)} of {formatMegabytes(attachmentQuotaBytes())} used). Delete some
          screenshots to add new ones.
        </p>
      ) : null}
      {accounts.length === 0 ? (
        <div className="card card-pad text-sm text-muted">
          Create an account first under <Link href="/accounts" className="text-accent underline">Accounts</Link>.
        </div>
      ) : (
        <div className="card card-pad">
          <TradeForm
            action={createTradeAction}
            accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, isDefault: a.isDefault }))}
            tags={tags.map(serializeTag)}
            timeZone={user.timeZone}
            defaultEntryAt={toDateTimeLocalValue(new Date(), user.timeZone)}
            submitLabel="Save trade"
            budget={budget}
            customRules={customRules.map(serializeRule)}
            currency={accounts.find((a) => a.isDefault)?.currency ?? accounts[0]?.currency ?? "USD"}
            prefill={capture.prefill}
            sizePresets={capture.sizePresets}
            draft={draft}
            sharedNote={draft?.note ?? note ?? ""}
          />
        </div>
      )}
    </div>
  );
}
