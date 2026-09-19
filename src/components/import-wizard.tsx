"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { useMemo, useState } from "react";
import type { AccountOption } from "@/components/trade-form";
import { ASSET_CLASSES, FIELD_INFO, IMPORT_FIELDS, guessMapping, parseImportRow, type ColumnMapping, type ImportOptions } from "@/lib/csv";
import { EXECUTION_FIELDS, EXECUTION_FIELD_INFO, guessExecutionMapping, matchFills, parseFillRow, type ExecutionMapping, type Fill, type MatchResult } from "@/lib/fills";
import { formatDateTime, formatMoney, formatNumber, formatPrice } from "@/lib/format";
import { tradeLabel } from "@/lib/options";
import { isThinkorswimStatement, thinkorswimTradeHistory } from "@/lib/thinkorswim";
import type { ImportModeKey } from "@/lib/validation";

type Row = Record<string, string>;
/** A column mapping for either mode; the keys belong to the mode's field set. */
type AnyMapping = Record<string, string>;

interface ImportReport {
  total: number;
  inserted: number;
  duplicates: number;
  errors: { row: number; message: string }[];
  unmatched?: number;
  batchId?: string;
}

export interface ImportPresetDTO {
  id: string;
  name: string;
  mapping: AnyMapping;
  options: { defaultAssetClass?: string; defaultMultiplier?: string; dayFirst?: boolean; timeZone?: string; mode?: ImportModeKey };
}

interface ExecutionPreview {
  fills: number;
  errors: { row: number; message: string }[];
  match: MatchResult;
}

const MAX_ROWS = 10000;
const FIELD_LABELS: Record<ImportModeKey, { fields: readonly string[]; info: Record<string, { label: string; required: boolean; hint: string }> }> = {
  trades: { fields: IMPORT_FIELDS, info: FIELD_INFO },
  executions: { fields: EXECUTION_FIELDS, info: EXECUTION_FIELD_INFO },
};

export function ImportWizard({ accounts, timeZone, presets: initialPresets = [] }: { accounts: AccountOption[]; timeZone: string; presets?: ImportPresetDTO[] }) {
  const router = useRouter();
  const [presets, setPresets] = useState<ImportPresetDTO[]>(initialPresets);
  const [presetName, setPresetName] = useState("");
  const [presetMessage, setPresetMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportModeKey>("trades");
  const [detected, setDetected] = useState<"thinkorswim" | null>(null);
  const [mapping, setMapping] = useState<AnyMapping>({});
  const [includeUnmatched, setIncludeUnmatched] = useState<Set<number>>(new Set());
  const [accountId, setAccountId] = useState(accounts.find((a) => a.isDefault)?.id ?? accounts[0]?.id ?? "");
  const [defaultAssetClass, setDefaultAssetClass] = useState<(typeof ASSET_CLASSES)[number]>("STOCK");
  const [defaultMultiplier, setDefaultMultiplier] = useState("1");
  const [dayFirst, setDayFirst] = useState(false);
  const [zone, setZone] = useState<"UTC" | "user">("UTC");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const options: ImportOptions = useMemo(
    () => ({ defaultAssetClass, defaultMultiplier, dayFirst, timeZone: zone === "user" ? timeZone : "UTC" }),
    [defaultAssetClass, defaultMultiplier, dayFirst, zone, timeZone],
  );

  const tradePreview = useMemo(() => {
    if (mode !== "trades" || rows.length === 0) return { sample: [], errorCount: 0, okCount: 0 };
    let errorCount = 0;
    let okCount = 0;
    const sample: { index: number; result: ReturnType<typeof parseImportRow> }[] = [];
    rows.forEach((row, i) => {
      const result = parseImportRow(row, mapping as ColumnMapping, options);
      if (result.ok) okCount++;
      else errorCount++;
      if (i < 15) sample.push({ index: i, result });
    });
    return { sample, errorCount, okCount };
  }, [mode, rows, mapping, options]);

  const executionPreview = useMemo<ExecutionPreview | null>(() => {
    if (mode !== "executions" || rows.length === 0) return null;
    const fills: Fill[] = [];
    const errors: { row: number; message: string }[] = [];
    rows.forEach((row, i) => {
      const result = parseFillRow(row, mapping as ExecutionMapping, options, i + 2);
      if (result.ok) fills.push(result.fill);
      else errors.push({ row: i + 2, message: result.error });
    });
    return { fills: fills.length, errors, match: matchFills(fills) };
  }, [mode, rows, mapping, options]);

  const currency = accounts.find((a) => a.id === accountId)?.currency ?? "USD";
  const { fields, info } = FIELD_LABELS[mode];
  const missingRequired = fields.filter((f) => info[f].required && !mapping[f]);
  const importCount = mode === "trades" ? tradePreview.okCount : (executionPreview?.match.trades.length ?? 0) + includeUnmatched.size;
  const errorCount = mode === "trades" ? tradePreview.errorCount : (executionPreview?.errors.length ?? 0);

  function switchMode(next: ImportModeKey) {
    setMode(next);
    setMapping(next === "trades" ? guessMapping(headers) : guessExecutionMapping(headers));
    setIncludeUnmatched(new Set());
  }

  function applyPreset(id: string) {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    const presetMode: ImportModeKey = preset.options.mode === "executions" ? "executions" : "trades";
    const allowed = FIELD_LABELS[presetMode].fields;
    const valid: AnyMapping = {};
    for (const [field, header] of Object.entries(preset.mapping)) {
      if (allowed.includes(field) && headers.includes(header)) valid[field] = header;
    }
    setMode(presetMode);
    setMapping(valid);
    setIncludeUnmatched(new Set());
    if (preset.options.defaultAssetClass && (ASSET_CLASSES as readonly string[]).includes(preset.options.defaultAssetClass)) {
      setDefaultAssetClass(preset.options.defaultAssetClass as (typeof ASSET_CLASSES)[number]);
    }
    if (preset.options.defaultMultiplier) setDefaultMultiplier(preset.options.defaultMultiplier);
    setDayFirst(!!preset.options.dayFirst);
    setZone(preset.options.timeZone && preset.options.timeZone !== "UTC" ? "user" : "UTC");
    const missing = Object.keys(preset.mapping).length - Object.keys(valid).length;
    setPresetMessage(missing ? `Applied “${preset.name}”; ${missing} column${missing === 1 ? "" : "s"} from the preset ${missing === 1 ? "is" : "are"} not in this file.` : `Applied “${preset.name}”.`);
  }

  async function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    setPresetMessage(null);
    const res = await fetch("/api/import/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mapping, options: { ...options, mode } }),
    });
    const data = (await res.json().catch(() => null)) as (ImportPresetDTO & { error?: string }) | null;
    if (!res.ok || !data) {
      setPresetMessage(data?.error ?? "Could not save the mapping.");
      return;
    }
    setPresets((list) => [...list.filter((p) => p.name !== data.name), data].sort((a, b) => a.name.localeCompare(b.name)));
    setPresetName("");
    setPresetMessage(`Saved “${data.name}”.`);
  }

  async function deletePreset(id: string) {
    const res = await fetch(`/api/import/presets/${id}`, { method: "DELETE" });
    if (res.ok) setPresets((list) => list.filter((p) => p.id !== id));
  }

  async function loadFile(file: File | null) {
    setReport(null);
    setSubmitError(null);
    setParseError(null);
    setDetected(null);
    setIncludeUnmatched(new Set());
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();

    // A thinkorswim Account Statement: only its Account Trade History section holds executions.
    if (isThinkorswimStatement(text)) {
      const section = thinkorswimTradeHistory(text);
      if (section && section.rows.length > 0) {
        setHeaders(section.headers);
        setRows(section.rows.slice(0, MAX_ROWS));
        setMode("executions");
        setMapping(guessExecutionMapping(section.headers));
        setDetected("thinkorswim");
        setZone("user");
        if (section.rows.length > MAX_ROWS) setParseError(`Only the first ${MAX_ROWS.toLocaleString()} fills are imported.`);
        return;
      }
    }

    const result = Papa.parse<Row>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
    const fields = (result.meta.fields ?? []).filter((f) => f !== "");
    if (fields.length === 0) {
      setParseError("Could not find a header row in this file.");
      setHeaders([]);
      setRows([]);
      return;
    }
    const data = result.data.slice(0, MAX_ROWS).map((r) => {
      const clean: Row = {};
      for (const f of fields) clean[f] = r[f] == null ? "" : String(r[f]);
      return clean;
    });
    setHeaders(fields);
    setRows(data);
    setMode("trades");
    setMapping(guessMapping(fields));
    if (result.data.length > MAX_ROWS) setParseError(`Only the first ${MAX_ROWS.toLocaleString()} rows are imported.`);
  }

  async function submit() {
    setBusy(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, accountId, mapping, options, rows, filename: fileName ?? undefined, includeUnmatched: mode === "executions" ? [...includeUnmatched] : undefined }),
      });
      const data = (await res.json().catch(() => null)) as (ImportReport & { error?: string }) | null;
      if (!res.ok || !data) throw new Error(data?.error ?? `Import failed (${res.status})`);
      setReport(data);
      router.refresh();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const match = executionPreview?.match ?? null;
  const closedCount = match ? match.trades.filter((t) => t.kind === "closed").length : 0;
  const openCount = match ? match.trades.length - closedCount : 0;

  return (
    <div className="flex flex-col gap-4">
      <section className="card card-pad">
        <h2 className="text-sm font-semibold">1. Choose a CSV file</h2>
        <p className="mt-1 text-xs text-muted">
          One row per trade, or one row per execution (fills are matched into trades). Columns are matched automatically and can be adjusted below. Option
          contracts in the symbol column (SPY240920C00450000, SPY 09/20/2024 450 C) are read as options on the underlying, and a thinkorswim Account
          Statement is recognised as a whole.
        </p>
        <label className="btn mt-3 w-fit cursor-pointer">
          {fileName ? "Choose another file" : "Choose file"}
          <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => loadFile(e.target.files?.[0] ?? null)} />
        </label>
        {fileName ? (
          <p className="mt-2 text-sm text-ink-2">
            {fileName} · {rows.length.toLocaleString()} {mode === "executions" ? "fills" : "rows"} · {headers.length} columns
          </p>
        ) : null}
        {detected === "thinkorswim" ? (
          <p role="status" className="mt-2 rounded-lg border border-signature/40 bg-signature-soft px-3 py-2 text-sm">
            thinkorswim Account Statement detected: only the Account Trade History section is imported ({rows.length.toLocaleString()} fills, matched into trades
            below); the other sections are ignored. Fill times are read in your zone.
          </p>
        ) : null}
        {parseError ? (
          <p role="alert" className="mt-2 text-sm text-warn">
            {parseError}
          </p>
        ) : null}
      </section>

      {rows.length > 0 ? (
        <>
          <section className="card card-pad">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">2. Map columns</h2>
              {presets.length ? (
                <div className="flex items-center gap-2">
                  <label htmlFor="preset-apply" className="text-xs text-muted">
                    Saved mapping
                  </label>
                  <select id="preset-apply" className="input w-auto py-1 text-xs" defaultValue="" onChange={(e) => e.target.value && applyPreset(e.target.value)}>
                    <option value="">Choose…</option>
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
            <fieldset className="mt-3">
              <legend className="label">Each row is</legend>
              <div className="flex flex-col gap-1.5 text-sm sm:flex-row sm:gap-4">
                <label className="flex items-center gap-2">
                  <input type="radio" name="mode" value="trades" checked={mode === "trades"} onChange={() => switchMode("trades")} /> A trade (entry and exit on one row)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="mode" value="executions" checked={mode === "executions"} onChange={() => switchMode("executions")} /> An execution (fills are matched into
                  trades)
                </label>
              </div>
            </fieldset>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((field) => (
                <div key={`${mode}-${field}`}>
                  <label htmlFor={`map-${field}`} className="label">
                    {info[field].label}
                    {info[field].required ? <span className="text-loss"> *</span> : null}
                  </label>
                  <select
                    id={`map-${field}`}
                    className={`input ${info[field].required && !mapping[field] ? "input-error" : ""}`}
                    value={mapping[field] ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      setMapping((m) => {
                        const next = { ...m };
                        if (value) next[field] = value;
                        else delete next[field];
                        return next;
                      });
                    }}
                  >
                    <option value="">Not mapped</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <p className="hint">{info[field].hint}</p>
                </div>
              ))}
            </div>

            <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">Options</h3>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label htmlFor="imp-account" className="label">
                  Account
                </label>
                <select id="imp-account" className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="imp-asset" className="label">
                  Default asset class
                </label>
                <select
                  id="imp-asset"
                  className="input"
                  value={defaultAssetClass}
                  onChange={(e) => setDefaultAssetClass(e.target.value as (typeof ASSET_CLASSES)[number])}
                >
                  {ASSET_CLASSES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="imp-mult" className="label">
                  Default multiplier
                </label>
                <input id="imp-mult" className="input" inputMode="decimal" value={defaultMultiplier} onChange={(e) => setDefaultMultiplier(e.target.value)} />
                <p className="hint">Options always use 100 unless a row says otherwise.</p>
              </div>
              <div>
                <span className="label">Dates</span>
                <label className="flex items-center gap-2 text-sm text-ink-2">
                  <input type="checkbox" checked={dayFirst} onChange={(e) => setDayFirst(e.target.checked)} />
                  Day comes first (31/12/2024)
                </label>
                <div className="mt-1 flex gap-3 text-sm text-ink-2">
                  <label className="flex items-center gap-1">
                    <input type="radio" name="zone" checked={zone === "UTC"} onChange={() => setZone("UTC")} /> UTC
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" name="zone" checked={zone === "user"} onChange={() => setZone("user")} /> {timeZone.replace(/_/g, " ")}
                  </label>
                </div>
                <p className="hint">Zone for times without an offset.</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <div className="min-w-48 flex-1">
                <label htmlFor="preset-name" className="label">
                  Save this mapping as
                </label>
                <input id="preset-name" className="input" placeholder="Broker name, e.g. Tradovate" value={presetName} maxLength={60} onChange={(e) => setPresetName(e.target.value)} />
              </div>
              <button type="button" className="btn" disabled={!presetName.trim()} onClick={savePreset}>
                Save mapping
              </button>
              {presets.length ? (
                <ul className="flex flex-wrap gap-1">
                  {presets.map((p) => (
                    <li key={p.id} className="badge gap-1.5">
                      {p.name}
                      <button type="button" className="text-muted hover:text-loss" aria-label={`Delete preset ${p.name}`} onClick={() => deletePreset(p.id)}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {presetMessage ? (
                <p role="status" className="basis-full text-xs text-ink-2">
                  {presetMessage}
                </p>
              ) : null}
            </div>
          </section>

          <section className="card card-pad">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">3. Preview</h2>
              {mode === "trades" ? (
                <p className="text-xs text-muted">
                  {tradePreview.okCount.toLocaleString()} rows ready
                  {tradePreview.errorCount ? <span className="text-warn"> · {tradePreview.errorCount.toLocaleString()} with errors (skipped)</span> : null}
                </p>
              ) : match ? (
                <p className="text-xs text-muted" data-testid="match-summary">
                  {executionPreview?.fills.toLocaleString()} fills → {match.trades.length} trade{match.trades.length === 1 ? "" : "s"} ({closedCount} closed, {openCount} open)
                  {match.unmatched.length ? <span className="text-warn"> · {match.unmatched.length} unmatched close{match.unmatched.length === 1 ? "" : "s"}</span> : null}
                  {executionPreview?.errors.length ? <span className="text-warn"> · {executionPreview.errors.length} row errors (skipped)</span> : null}
                </p>
              ) : null}
            </div>
            {missingRequired.length ? (
              <p role="alert" className="mt-2 text-sm text-loss">
                Map the required columns first: {missingRequired.map((f) => info[f].label).join(", ")}.
              </p>
            ) : null}
            {mode === "trades" ? (
              <div className="mt-3 overflow-x-auto">
                <table className="table min-w-[640px]">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Entry</th>
                      <th className="text-right">Exit</th>
                      <th>Entry time</th>
                      <th className="text-right">Net P&L</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tradePreview.sample.map(({ index, result }) => (
                      <tr key={index}>
                        <td className="num text-muted">{index + 2}</td>
                        {result.ok ? (
                          <>
                            <td className="font-medium">
                              {tradeLabel({ symbol: result.row.symbol, assetClass: result.row.assetClass, optionType: result.row.optionType, strikePrice: result.row.strikePrice, expiresAt: result.row.expiresAt })}
                            </td>
                            <td>{result.row.side}</td>
                            <td className="num text-right">{result.row.quantity}</td>
                            <td className="num text-right">{formatPrice(result.row.entryPrice)}</td>
                            <td className="num text-right">{formatPrice(result.row.exitPrice)}</td>
                            <td className="num text-ink-2">{result.row.entryAt.toISOString().replace("T", " ").slice(0, 16)}Z</td>
                            <td className={`num text-right ${result.row.pnl && Number(result.row.pnl) > 0 ? "text-profit" : result.row.pnl && Number(result.row.pnl) < 0 ? "text-loss" : ""}`}>
                              {result.row.pnl !== null ? formatMoney(result.row.pnl, { currency, signed: true }) : "—"}
                            </td>
                            <td>{result.row.status}</td>
                          </>
                        ) : (
                          <td colSpan={8} className="text-warn">
                            {result.error}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : match ? (
              <>
                {match.warnings.length ? (
                  <ul className="mt-2 flex flex-col gap-1 text-xs text-warn" aria-label="Matching notes">
                    {match.warnings.slice(0, 20).map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-3 overflow-x-auto">
                  <table className="table min-w-[640px]" aria-label="Matched trades">
                    <thead>
                      <tr>
                        <th>Trade</th>
                        <th>Side</th>
                        <th className="text-right">Qty</th>
                        <th className="text-right">Entry → exit</th>
                        <th>Entered</th>
                        <th className="text-right">Net P&L</th>
                        <th>Status</th>
                        <th className="text-right">Fills</th>
                      </tr>
                    </thead>
                    <tbody>
                      {match.trades.slice(0, 25).map((t) => (
                        <tr key={`${t.importHashKey}-${t.fillRows[0]}`}>
                          <td className="font-medium">{t.label}</td>
                          <td>{t.side}</td>
                          <td className="num text-right">{t.quantity}</td>
                          <td className="num text-right">
                            {formatPrice(t.entryPrice)}
                            {t.exitPrice !== null ? ` → ${formatPrice(t.exitPrice)}` : ""}
                          </td>
                          <td className="num text-ink-2">{formatDateTime(t.entryAt, zone === "user" ? timeZone : "UTC")}</td>
                          <td className={`num text-right ${t.pnl && Number(t.pnl) > 0 ? "text-profit" : t.pnl && Number(t.pnl) < 0 ? "text-loss" : ""}`}>
                            {t.pnl !== null ? formatMoney(t.pnl, { currency, signed: true }) : "—"}
                          </td>
                          <td>{t.status}</td>
                          <td className="num text-right text-muted">{t.fillRows.length}</td>
                        </tr>
                      ))}
                      {executionPreview?.errors.slice(0, 10).map((e) => (
                        <tr key={`err-${e.row}`}>
                          <td colSpan={8} className="text-warn">
                            Row {e.row}: {e.message}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {match.trades.length > 25 ? <p className="mt-2 text-xs text-muted">Showing the first 25 of {match.trades.length} trades.</p> : null}
                {match.unmatched.length ? (
                  <section className="mt-4 rounded-lg border border-warn/40 bg-surface-2 p-3" aria-label="Unmatched closes">
                    <p className="text-sm font-semibold text-warn">
                      {match.unmatched.length} closing fill{match.unmatched.length === 1 ? "" : "s"} without an open in this file
                    </p>
                    <p className="mt-1 text-xs text-ink-2">
                      These positions were opened before the statement window, so the entry is not in the file. They are skipped unless ticked; export a wider date
                      range to bring the real entries in, or tick one to store it as a closed trade whose entry is marked as unknown (the result is then the fees
                      only).
                    </p>
                    <ul className="mt-2 flex flex-col gap-2">
                      {match.unmatched.map((u) => (
                        <li key={u.row} className="flex flex-col gap-1 rounded-md border border-line bg-canvas p-2 text-sm">
                          <p>
                            <span className="font-medium">{u.label}</span> · {u.side} {formatNumber(u.quantity, 8)} on {formatDateTime(u.time, zone === "user" ? timeZone : "UTC")} · row {u.row}
                          </p>
                          <p className="text-xs text-muted">{u.reason}</p>
                          <label className="flex items-center gap-2 text-xs text-ink-2">
                            <input
                              type="checkbox"
                              checked={includeUnmatched.has(u.row)}
                              onChange={(e) =>
                                setIncludeUnmatched((set) => {
                                  const next = new Set(set);
                                  if (e.target.checked) next.add(u.row);
                                  else next.delete(u.row);
                                  return next;
                                })
                              }
                            />
                            Import as a closed trade with an unknown entry
                          </label>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </>
            ) : null}
            {mode === "trades" && rows.length > tradePreview.sample.length ? (
              <p className="mt-2 text-xs text-muted">Showing the first {tradePreview.sample.length} of {rows.length.toLocaleString()} rows.</p>
            ) : null}
          </section>

          <section className="card card-pad">
            <h2 className="text-sm font-semibold">4. Import</h2>
            <p className="mt-1 text-xs text-muted">
              Trades already in the journal (same symbol, side, quantity, entry price and entry time) are skipped as duplicates, so importing the same file twice adds
              nothing. Every import can be undone from the history below.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || importCount === 0 || missingRequired.length > 0 || !accountId}
                onClick={submit}
              >
                {busy ? "Importing…" : `Import ${importCount.toLocaleString()} trade${importCount === 1 ? "" : "s"}`}
              </button>
              {submitError ? (
                <p role="alert" className="text-sm text-loss">
                  {submitError}
                </p>
              ) : null}
            </div>
            {report ? (
              <div className="mt-4 rounded-lg border border-line bg-canvas p-3 text-sm" role="status">
                <p className="font-semibold">Import finished</p>
                <ul className="mt-1 grid grid-cols-3 gap-2 text-center">
                  <li className="rounded-md bg-surface p-2">
                    <p className="text-lg font-semibold text-profit">{report.inserted}</p>
                    <p className="text-xs text-muted">inserted</p>
                  </li>
                  <li className="rounded-md bg-surface p-2">
                    <p className="text-lg font-semibold text-ink">{report.duplicates}</p>
                    <p className="text-xs text-muted">duplicates skipped</p>
                  </li>
                  <li className="rounded-md bg-surface p-2">
                    <p className={`text-lg font-semibold ${report.errors.length || errorCount ? "text-warn" : "text-ink"}`}>{report.errors.length}</p>
                    <p className="text-xs text-muted">row errors</p>
                  </li>
                </ul>
                {report.unmatched ? (
                  <p className="mt-2 text-xs text-ink-2">
                    {report.unmatched} unmatched close{report.unmatched === 1 ? "" : "s"} left out; export a wider date range to include {report.unmatched === 1 ? "it" : "them"}.
                  </p>
                ) : null}
                {report.errors.length ? (
                  <ul className="mt-2 max-h-40 overflow-auto text-xs text-ink-2">
                    {report.errors.slice(0, 100).map((e) => (
                      <li key={`${e.row}-${e.message}`}>
                        Row {e.row}: {e.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <Link href="/trades" className="btn btn-sm mt-3">
                  View trades
                </Link>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
