import Link from "next/link";
import { createTradeAction } from "@/actions/trades";
import { TradeForm } from "@/components/trade-form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadCapturePrefill, loadDraft } from "@/lib/queries/capture";
import { loadBudget } from "@/lib/queries/today";
import { serializeRule, serializeTag } from "@/lib/serialize";
import { dateKeyInZone, toDateTimeLocalValue } from "@/lib/tz";

export const metadata = { title: "New trade" };

export default async function NewTradePage({ searchParams }: { searchParams: Promise<{ draft?: string; note?: string }> }) {
  const user = await requireUser();
  const { draft: draftId, note } = await searchParams;
  const [accounts, tags, customRules, budget, capture, draft] = await Promise.all([
    db.account.findMany({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    db.tag.findMany({ where: { userId: user.id }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    db.rule.findMany({ where: { userId: user.id, active: true, kind: "CUSTOM" }, orderBy: { createdAt: "asc" } }),
    loadBudget(user.id, user.timeZone, dateKeyInZone(new Date(), user.timeZone)),
    loadCapturePrefill(user.id),
    loadDraft(user.id, draftId),
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
