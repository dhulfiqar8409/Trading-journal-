export function TooltipFrame({ title, rows }: { title: string; rows: { label: string; value: string; tone?: "profit" | "loss" | null }[] }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-muted">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-4">
          <span className="text-muted">{r.label}</span>
          <span className={`num font-semibold ${r.tone === "profit" ? "text-profit" : r.tone === "loss" ? "text-loss" : "text-ink"}`}>
            {r.value}
          </span>
        </p>
      ))}
    </div>
  );
}

export function toneOf(value: number): "profit" | "loss" | null {
  return value > 0 ? "profit" : value < 0 ? "loss" : null;
}
