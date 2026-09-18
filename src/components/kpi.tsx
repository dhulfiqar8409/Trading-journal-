import { pnlClass } from "@/lib/format";

export function StatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Signed figure used to colour the value (profit/loss); omit for neutral. */
  tone?: number | null;
}) {
  const color = tone === undefined ? "text-ink" : pnlClass(tone);
  return (
    <div className="card flex min-w-0 flex-col justify-between p-4">
      <p className="text-xs text-ink-2">{label}</p>
      <p className={`mt-1 truncate text-xl font-semibold leading-none sm:text-2xl ${color}`}>{value}</p>
      <p className="mt-2 text-xs text-muted">{sub ?? "\u00a0"}</p>
    </div>
  );
}
