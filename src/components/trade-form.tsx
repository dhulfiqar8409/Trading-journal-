"use client";

import { useActionState, useMemo, useState } from "react";
import { FieldError, FormMessage, SubmitButton, fieldClass } from "@/components/forms";
import { TAG_KIND_LABELS } from "@/components/tag-chip";
import { ASSET_CLASSES } from "@/lib/csv";
import { formatMoney, formatR } from "@/lib/format";
import type { ActionState } from "@/lib/form";
import { computeTradeMetrics, type Side } from "@/lib/pnl";
import type { TagDTO, TradeDTO } from "@/lib/serialize";
import { toDateTimeLocalValue } from "@/lib/tz";

export interface AccountOption {
  id: string;
  name: string;
  currency: string;
  isDefault: boolean;
}

interface TradeFormProps {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  accounts: AccountOption[];
  tags: TagDTO[];
  timeZone: string;
  initial?: TradeDTO | null;
  /** datetime-local value used for new trades. */
  defaultEntryAt: string;
  submitLabel: string;
}

const ASSET_LABELS: Record<(typeof ASSET_CLASSES)[number], string> = {
  STOCK: "Stock / ETF",
  OPTION: "Option",
  FUTURES: "Futures",
  FOREX: "Forex",
  CRYPTO: "Crypto",
};

interface Preview {
  pnl: string | null;
  r: string | null;
  status: "OPEN" | "CLOSED";
}

function previewFrom(form: HTMLFormElement): Preview | null {
  const fd = new FormData(form);
  const get = (k: string) => String(fd.get(k) ?? "").trim();
  const num = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
  const quantity = get("quantity");
  const entryPrice = get("entryPrice");
  if (!num.test(quantity) || !num.test(entryPrice)) return null;
  const optional = (k: string) => (num.test(get(k)) ? get(k) : null);
  try {
    const metrics = computeTradeMetrics({
      side: (get("side") as Side) || "LONG",
      quantity,
      entryPrice,
      exitPrice: optional("exitPrice"),
      multiplier: optional("multiplier") ?? "1",
      fees: optional("fees") ?? "0",
      stopPrice: optional("stopPrice"),
      targetPrice: optional("targetPrice"),
    });
    return {
      status: metrics.status,
      pnl: metrics.pnl ? metrics.pnl.toFixed() : null,
      r: metrics.rMultiple ? metrics.rMultiple.toFixed() : null,
    };
  } catch {
    return null;
  }
}

export function TradeForm({ action, accounts, tags, timeZone, initial, defaultEntryAt, submitLabel }: TradeFormProps) {
  const [state, formAction] = useActionState(action, null);
  const [preview, setPreview] = useState<Preview | null>(() =>
    initial ? { status: initial.status, pnl: initial.pnlExact, r: initial.rMultiple === null ? null : String(initial.rMultiple) } : null,
  );
  const defaultAccount = initial?.accountId ?? accounts.find((a) => a.isDefault)?.id ?? accounts[0]?.id ?? "";
  const currency = accounts.find((a) => a.id === defaultAccount)?.currency ?? "USD";
  const selectedTags = useMemo(() => new Set(initial?.tags.map((t) => t.id) ?? []), [initial]);
  const groups = useMemo(() => {
    const byKind = new Map<TagDTO["kind"], TagDTO[]>();
    for (const tag of tags) byKind.set(tag.kind, [...(byKind.get(tag.kind) ?? []), tag]);
    return [...byKind.entries()];
  }, [tags]);

  const entryDefault = initial ? toDateTimeLocalValue(new Date(initial.entryAt), timeZone) : defaultEntryAt;
  const exitDefault = initial?.exitAt ? toDateTimeLocalValue(new Date(initial.exitAt), timeZone) : "";

  return (
    <form
      action={formAction}
      onChange={(e) => setPreview(previewFrom(e.currentTarget))}
      className="flex flex-col gap-6"
      noValidate={false}
    >
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor="accountId" className="label">
            Account
          </label>
          <select id="accountId" name="accountId" defaultValue={defaultAccount} className={fieldClass(state, "accountId")}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
          <FieldError state={state} name="accountId" />
        </div>
        <div>
          <label htmlFor="symbol" className="label">
            Symbol
          </label>
          <input
            id="symbol"
            name="symbol"
            defaultValue={initial?.symbol ?? ""}
            required
            maxLength={32}
            autoCapitalize="characters"
            placeholder="AAPL"
            className={`${fieldClass(state, "symbol")} uppercase`}
          />
          <FieldError state={state} name="symbol" />
        </div>
        <div>
          <label htmlFor="assetClass" className="label">
            Asset class
          </label>
          <select id="assetClass" name="assetClass" defaultValue={initial?.assetClass ?? "STOCK"} className="input">
            {ASSET_CLASSES.map((c) => (
              <option key={c} value={c}>
                {ASSET_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="label">Side</span>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-canvas p-1">
            {(["LONG", "SHORT"] as const).map((side) => (
              <label key={side} className="cursor-pointer">
                <input type="radio" name="side" value={side} defaultChecked={(initial?.side ?? "LONG") === side} className="peer sr-only" />
                <span className="block rounded-md py-1.5 text-center text-sm font-medium text-muted peer-checked:bg-surface-3 peer-checked:text-ink peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40">
                  {side === "LONG" ? "Long" : "Short"}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="quantity" className="label">
            Quantity
          </label>
          <input
            id="quantity"
            name="quantity"
            inputMode="decimal"
            defaultValue={initial?.quantity ?? ""}
            required
            placeholder="100"
            className={fieldClass(state, "quantity")}
          />
          <FieldError state={state} name="quantity" />
        </div>
        <div>
          <label htmlFor="multiplier" className="label">
            Multiplier
          </label>
          <input
            id="multiplier"
            name="multiplier"
            inputMode="decimal"
            defaultValue={initial?.multiplier ?? "1"}
            className={fieldClass(state, "multiplier")}
          />
          <p className="hint">Point value (futures) or contract size (options).</p>
          <FieldError state={state} name="multiplier" />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="entryPrice" className="label">
            Entry price
          </label>
          <input
            id="entryPrice"
            name="entryPrice"
            inputMode="decimal"
            defaultValue={initial?.entryPrice ?? ""}
            required
            className={fieldClass(state, "entryPrice")}
          />
          <FieldError state={state} name="entryPrice" />
        </div>
        <div>
          <label htmlFor="exitPrice" className="label">
            Exit price
          </label>
          <input
            id="exitPrice"
            name="exitPrice"
            inputMode="decimal"
            defaultValue={initial?.exitPrice ?? ""}
            placeholder="Leave empty while open"
            className={fieldClass(state, "exitPrice")}
          />
          <FieldError state={state} name="exitPrice" />
        </div>
        <div>
          <label htmlFor="fees" className="label">
            Fees
          </label>
          <input id="fees" name="fees" inputMode="decimal" defaultValue={initial?.fees ?? "0"} className={fieldClass(state, "fees")} />
          <FieldError state={state} name="fees" />
        </div>
        <div>
          <label htmlFor="stopPrice" className="label">
            Stop price
          </label>
          <input
            id="stopPrice"
            name="stopPrice"
            inputMode="decimal"
            defaultValue={initial?.stopPrice ?? ""}
            className={fieldClass(state, "stopPrice")}
          />
          <FieldError state={state} name="stopPrice" />
        </div>
        <div>
          <label htmlFor="targetPrice" className="label">
            Target price
          </label>
          <input
            id="targetPrice"
            name="targetPrice"
            inputMode="decimal"
            defaultValue={initial?.targetPrice ?? ""}
            className={fieldClass(state, "targetPrice")}
          />
          <FieldError state={state} name="targetPrice" />
        </div>
        <div className="rounded-lg border border-line bg-canvas px-3 py-2">
          <p className="text-xs text-muted">Preview</p>
          {preview ? (
            <p className="num text-sm">
              <span className="text-ink-2">{preview.status === "OPEN" ? "Open" : "Net P&L"}</span>{" "}
              {preview.pnl !== null ? (
                <span className={Number(preview.pnl) > 0 ? "text-profit" : Number(preview.pnl) < 0 ? "text-loss" : ""}>
                  {formatMoney(preview.pnl, { currency, signed: true })}
                </span>
              ) : null}
              {preview.r !== null ? <span className="text-muted"> · {formatR(preview.r)}</span> : null}
            </p>
          ) : (
            <p className="text-sm text-muted">Enter quantity and prices</p>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="entryAt" className="label">
            Entry time
          </label>
          <input
            id="entryAt"
            name="entryAt"
            type="datetime-local"
            defaultValue={entryDefault}
            required
            className={fieldClass(state, "entryAt")}
          />
          <p className="hint">Times are in {timeZone.replace(/_/g, " ")}.</p>
          <FieldError state={state} name="entryAt" />
        </div>
        <div>
          <label htmlFor="exitAt" className="label">
            Exit time
          </label>
          <input id="exitAt" name="exitAt" type="datetime-local" defaultValue={exitDefault} className={fieldClass(state, "exitAt")} />
          <p className="hint">Defaults to the entry time when an exit price is given.</p>
          <FieldError state={state} name="exitAt" />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <span className="label">Rating</span>
          <div className="flex gap-1" role="radiogroup" aria-label="Execution rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="cursor-pointer">
                <input type="radio" name="rating" value={n} defaultChecked={initial?.rating === n} className="peer sr-only" />
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-sm text-muted peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-ink peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40">
                  {n}
                </span>
              </label>
            ))}
          </div>
          <p className="hint">How well you executed the plan, 1 (poor) to 5 (flawless).</p>
        </div>

        <div>
          <span className="label">Tags</span>
          {tags.length === 0 ? (
            <p className="text-sm text-muted">No tags yet. Create strategies, setups and mistakes under Tags.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {groups.map(([kind, list]) => (
                <div key={kind} className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 w-16 text-xs text-muted">{TAG_KIND_LABELS[kind]}</span>
                  {list.map((tag) => (
                    <label key={tag.id} className="cursor-pointer">
                      <input type="checkbox" name="tagIds" value={tag.id} defaultChecked={selectedTags.has(tag.id)} className="peer sr-only" />
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-ink-2 peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-ink peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden />
                        {tag.name}
                      </span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="notes" className="label">
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={6}
            defaultValue={initial?.notes ?? ""}
            placeholder="Thesis, execution, what you saw. Markdown is supported."
            className={fieldClass(state, "notes")}
          />
          <FieldError state={state} name="notes" />
        </div>
        <div>
          <label htmlFor="mistakes" className="label">
            Mistakes
          </label>
          <textarea id="mistakes" name="mistakes" rows={2} defaultValue={initial?.mistakes ?? ""} className={fieldClass(state, "mistakes")} />
          <FieldError state={state} name="mistakes" />
        </div>
      </section>

      <FormMessage state={state} />
      <div className="flex items-center gap-3">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
