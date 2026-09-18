import Link from "next/link";
import { pnlClass } from "@/lib/format";

export function StatTile({
  label,
  value,
  sub,
  tone,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Signed figure used to colour the value (profit/loss); omit for neutral. */
  tone?: number | null;
  /** Makes the whole tile a link. */
  href?: string;
}) {
  const color = tone === undefined ? "text-ink" : pnlClass(tone);
  const body = (
    <>
      <p className="text-xs text-ink-2">{label}</p>
      <p className={`figure mt-1 truncate text-xl leading-none sm:text-2xl ${color}`}>{value}</p>
      <p className="mt-2 text-xs text-muted">{sub ?? "\u00a0"}</p>
    </>
  );
  const className = "card flex min-w-0 flex-col justify-between p-4";
  if (href) {
    return (
      <Link href={href} className={`${className} pressable hover:bg-surface-2`}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}
