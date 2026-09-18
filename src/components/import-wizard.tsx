"use client";

import Link from "next/link";
import Papa from "papaparse";
import { useMemo, useState } from "react";
import type { AccountOption } from "@/components/trade-form";
import { ASSET_CLASSES, FIELD_INFO, IMPORT_FIELDS, guessMapping, parseImportRow, type ColumnMapping, type ImportOptions } from "@/lib/csv";
import { formatMoney, formatPrice } from "@/lib/format";

type Row = Record<string, string>;

interface ImportReport {
  total: number;
  inserted: number;
  duplicates: number;
  errors: { row: number; message: string }[];
}

export interface ImportPresetDTO {
  id: string;
  name: string;
  mapping: ColumnMapping;
  options: { defaultAssetClass?: string; defaultMultiplier?: string; dayFirst?: boolean; timeZone?: string };
}

const MAX_ROWS = 10000;

export function ImportWizard({ accounts, timeZone, presets: initialPresets = [] }: { accounts: AccountOption[]; timeZone: string; presets?: ImportPresetDTO[] }) {
  const [presets, setPresets] = useState<ImportPresetDTO[]>(initialPresets);
  const [presetName, setPresetName] = useState("");
  const [presetMessage, setPresetMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
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

  const preview = useMemo(() => {
    if (rows.length === 0) return { sample: [], errorCount: 0, okCount: 0 };
    let errorCount = 0;
    let okCount = 0;
    const sample: { index: number; result: ReturnType<typeof parseImportRow> }[] = [];
    rows.forEach((row, i) => {
      const result = parseImportRow(row, mapping, options);
      if (result.ok) okCount++;
      else errorCount++;
      if (i < 15) sample.push({ index: i, result });
    });
    return { sample, errorCount, okCount };
  }, [rows, mapping, options]);

  const currency = accounts.find((a) => a.id === accountId)?.currency ?? "USD";
  const missingRequired = IMPORT_FIELDS.filter((f) => FIELD_INFO[f].required && !mapping[f]);

  function applyPreset(id: string) {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    const valid: ColumnMapping = {};
    for (const [field, header] of Object.entries(preset.mapping) as [keyof ColumnMapping, string][]) {
      if (headers.includes(header)) valid[field] = header;
    }
    setMapping(valid);
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
      body: JSON.stringify({ name, mapping, options }),
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

  function loadFile(file: File | null) {
    setReport(null);
    setSubmitError(null);
    setParseError(null);
    if (!file) return;
    setFileName(file.name);
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: (result) => {
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
        setMapping(guessMapping(fields));
        if (result.data.length > MAX_ROWS) setParseError(`Only the first ${MAX_ROWS.toLocaleString()} rows are imported.`);
      },
      error: (err) => setParseError(err.message),
    });
  }

  async function submit() {
    setBusy(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, mapping, options, rows }),
      });
      const data = (await res.json().catch(() => null)) as (ImportReport & { error?: string }) | null;
      if (!res.ok || !data) throw new Error(data?.error ?? `Import failed (${res.status})`);
      setReport(data);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="card card-pad">
        <h2 className="text-sm font-semibold">1. Choose a CSV file</h2>
        <p className="mt-1 text-xs text-muted">
          One row per trade with a header row. Columns are matched automatically and can be adjusted below.
        </p>
        <label className="btn mt-3 w-fit cursor-pointer">
          {fileName ? "Choose another file" : "Choose file"}
          <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => loadFile(e.target.files?.[0] ?? null)} />
        </label>
        {fileName ? (
          <p className="mt-2 text-sm text-ink-2">
            {fileName} · {rows.length.toLocaleString()} rows · {headers.length} columns
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
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {IMPORT_FIELDS.map((field) => (
                <div key={field}>
                  <label htmlFor={`map-${field}`} className="label">
                    {FIELD_INFO[field].label}
                    {FIELD_INFO[field].required ? <span className="text-loss"> *</span> : null}
                  </label>
                  <select
                    id={`map-${field}`}
                    className={`input ${FIELD_INFO[field].required && !mapping[field] ? "input-error" : ""}`}
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
                  <p className="hint">{FIELD_INFO[field].hint}</p>
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
              <p className="text-xs text-muted">
                {preview.okCount.toLocaleString()} rows ready
                {preview.errorCount ? <span className="text-warn"> · {preview.errorCount.toLocaleString()} with errors (skipped)</span> : null}
              </p>
            </div>
            {missingRequired.length ? (
              <p role="alert" className="mt-2 text-sm text-loss">
                Map the required columns first: {missingRequired.map((f) => FIELD_INFO[f].label).join(", ")}.
              </p>
            ) : null}
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
                  {preview.sample.map(({ index, result }) => (
                    <tr key={index}>
                      <td className="num text-muted">{index + 2}</td>
                      {result.ok ? (
                        <>
                          <td className="font-medium">{result.row.symbol}</td>
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
            {rows.length > preview.sample.length ? (
              <p className="mt-2 text-xs text-muted">Showing the first {preview.sample.length} of {rows.length.toLocaleString()} rows.</p>
            ) : null}
          </section>

          <section className="card card-pad">
            <h2 className="text-sm font-semibold">4. Import</h2>
            <p className="mt-1 text-xs text-muted">
              Rows already in the journal (same symbol, side, quantity, entry price and entry time) are skipped as duplicates.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || preview.okCount === 0 || missingRequired.length > 0 || !accountId}
                onClick={submit}
              >
                {busy ? "Importing…" : `Import ${preview.okCount.toLocaleString()} trades`}
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
                    <p className={`text-lg font-semibold ${report.errors.length ? "text-warn" : "text-ink"}`}>{report.errors.length}</p>
                    <p className="text-xs text-muted">row errors</p>
                  </li>
                </ul>
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
