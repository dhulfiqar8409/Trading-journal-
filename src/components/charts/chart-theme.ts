/** Chart chrome shared by every Recharts component; colours come from the CSS theme tokens. */
export const chartTheme = {
  accent: "var(--color-accent)",
  profit: "var(--color-profit-mark)",
  loss: "var(--color-loss-mark)",
  grid: "var(--color-line)",
  axis: "var(--color-line-strong)",
  surface: "var(--color-surface)",
  text: "var(--color-muted)",
  tick: { fill: "var(--color-muted)", fontSize: 11 },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDateKey(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function shortDateInZone(t: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(new Date(t));
  return parts;
}

export function compactMoney(value: number, currency: string): string {
  const abs = Math.abs(value);
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    notation: abs >= 10000 ? "compact" : "standard",
    maximumFractionDigits: abs >= 10000 ? 1 : 0,
  });
  return formatter.format(value);
}
