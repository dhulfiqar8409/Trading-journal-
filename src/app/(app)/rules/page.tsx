import { NewRuleForm, RuleRow } from "@/components/rule-manager";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { flattenSearchParams, type SearchParams } from "@/lib/search-params";
import { serializeRule } from "@/lib/serialize";

export const metadata = { title: "Rules" };

export default async function RulesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const raw = flattenSearchParams(await searchParams);
  const rules = await db.rule.findMany({
    where: { userId: user.id },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    include: { _count: { select: { events: true } } },
  });
  const brokenCounts = await db.ruleEvent.groupBy({
    by: ["ruleId"],
    where: { rule: { userId: user.id }, status: { not: "FOLLOWED" } },
    _count: { _all: true },
  });
  const brokenByRule = new Map(brokenCounts.map((b) => [b.ruleId, b._count._all]));
  const prefill = raw.kind ? { kind: raw.kind, value: raw.value, timeValue: raw.timeValue, title: raw.title } : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="page-title">Rules</h1>
        <p className="mt-1 text-sm text-muted">
          Deterministic rules are checked automatically on every trade; custom rules are ticked by hand. Breaking one needs a one-line
          justification, which lands in the Tilt Ledger.
        </p>
      </div>
      <section className="card card-pad">
        <h2 className="mb-3 text-sm font-semibold">{prefill ? "Add the suggested rule" : "New rule"}</h2>
        <NewRuleForm prefill={prefill} />
      </section>
      <section className="card card-pad">
        <h2 className="text-sm font-semibold">Your rules</h2>
        {rules.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No rules yet. Start with “Stop required” and a daily trade cap.</p>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {rules.map((r) => (
              <RuleRow key={r.id} rule={serializeRule(r)} eventCount={r._count.events} brokenCount={brokenByRule.get(r.id) ?? 0} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
