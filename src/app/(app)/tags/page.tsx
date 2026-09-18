import { TAG_KIND_LABELS } from "@/components/tag-chip";
import { NewTagForm, TagRow } from "@/components/tag-manager";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { serializeTag } from "@/lib/serialize";
import { TAG_KINDS } from "@/lib/validation";

export const metadata = { title: "Tags" };

export default async function TagsPage() {
  const user = await requireUser();
  const tags = await db.tag.findMany({
    where: { userId: user.id },
    orderBy: { name: "asc" },
    include: { _count: { select: { trades: true } } },
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Tags</h1>
        <p className="mt-1 text-sm text-muted">Label trades by strategy, setup and mistake to see which ones make money.</p>
      </div>
      <section className="card card-pad">
        <h2 className="mb-3 text-sm font-semibold">New tag</h2>
        <NewTagForm />
      </section>
      {TAG_KINDS.map((kind) => {
        const list = tags.filter((t) => t.kind === kind);
        return (
          <section key={kind} className="card card-pad">
            <h2 className="text-sm font-semibold">{TAG_KIND_LABELS[kind]}</h2>
            {list.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No {TAG_KIND_LABELS[kind].toLowerCase()} tags yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {list.map((t) => (
                  <TagRow key={t.id} tag={serializeTag(t)} tradeCount={t._count.trades} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
