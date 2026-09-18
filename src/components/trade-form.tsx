"use client";

import { useMemo, useRef, useState } from "react";
import { BudgetBars } from "@/components/budget-bar";
import { DictationButton } from "@/components/dictation";
import { FieldError, FormMessage, SubmitButton, fieldClass, useActionForm } from "@/components/forms";
import { TAG_KIND_LABELS } from "@/components/tag-chip";
import type { CapturePrefill, DraftDTO } from "@/lib/queries/capture";
import type { BudgetDTO } from "@/lib/queries/today";
import { ASSET_CLASSES } from "@/lib/csv";
import { formatMoney, formatR } from "@/lib/format";
import type { ActionState } from "@/lib/form";
import { expirationKey, OPTION_MULTIPLIER, OPTION_TYPES } from "@/lib/options";
import { computeTradeMetrics, type Side } from "@/lib/pnl";
import type { RuleDTO, TagDTO, TradeDTO } from "@/lib/serialize";
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
  /** Today's plan budget, shown above the form. */
  budget?: BudgetDTO | null;
  /** Active CUSTOM rules, ticked by hand. */
  customRules?: RuleDTO[];
  currency?: string;
  /** Quick capture: last trade's instrument, account and size. */
  prefill?: CapturePrefill | null;
  sizePresets?: string[];
  /** A screenshot shared from the phone, attached on save. */
  draft?: DraftDTO | null;
  /** Free text passed from the share sheet. */
  sharedNote?: string;
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

export function TradeForm({
  action,
  accounts,
  tags,
  timeZone,
  initial,
  defaultEntryAt,
  submitLabel,
  budget = null,
  customRules = [],
  currency: budgetCurrency = "USD",
  prefill = null,
  sizePresets = [],
  draft = null,
  sharedNote = "",
}: TradeFormProps) {
  const { state, onSubmit, pending } = useActionForm(action);
  const quantityRef = useRef<HTMLInputElement>(null);
  const multiplierRef = useRef<HTMLInputElement>(null);
  const isNew = !initial;
  const seed = initial ?? null;
  const symbolDefault = seed?.symbol ?? prefill?.symbol ?? "";
  const quantityDefault = seed?.quantity ?? prefill?.quantity ?? "";
  const multiplierDefault = seed?.multiplier ?? prefill?.multiplier ?? "1";
  const assetDefault = seed?.assetClass ?? prefill?.assetClass ?? "STOCK";
  const [assetClass, setAssetClass] = useState<(typeof ASSET_CLASSES)[number]>(assetDefault);
  const isOption = assetClass === "OPTION";
  const optionTypeDefault = seed?.optionType ?? prefill?.optionType ?? "CALL";
  function applyPreset(q: string) {
    if (!quantityRef.current) return;
    quantityRef.current.value = q;
    quantityRef.current.form?.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function changeAssetClass(next: (typeof ASSET_CLASSES)[number]) {
    setAssetClass(next);
    // Options are 100-share contracts unless the owner typed a multiplier of their own.
    const m = multiplierRef.current;
    if (m && next === "OPTION" && (m.value.trim() === "" || m.value.trim() === "1")) m.value = OPTION_MULTIPLIER;
    if (m && next !== "OPTION" && m.value.trim() === OPTION_MULTIPLIER) m.value = "1";
    m?.form?.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const brokenFromState = state && !state.ok ? (state.brokenRules ?? []) : [];
  const brokenInitial = (initial?.ruleEvents ?? []).filter((e) => e.status !== "FOLLOWED");
  const showJustification = brokenFromState.length > 0 || brokenInitial.length > 0;
  const initialJustification = brokenInitial.find((e) => e.justification)?.justification ?? "";
  const initialOverridden = brokenInitial.some((e) => e.status === "OVERRIDDEN");
  const customFollowedInitial = new Set(
    (initial?.ruleEvents ?? []).filter((e) => e.ruleKind === "CUSTOM" && e.status === "FOLLOWED").map((e) => e.ruleId),
  );
  const [preview, setPreview] = useState<Preview | null>(() =>
    initial ? { status: initial.status, pnl: initial.pnlExact, r: initial.rMultiple === null ? null : String(initial.rMultiple) } : null,
  );
  const defaultAccount = initial?.accountId ?? prefill?.accountId ?? accounts.find((a) => a.isDefault)?.id ?? accounts[0]?.id ?? "";
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
      onSubmit={onSubmit}
      onChange={(e) => setPreview(previewFrom(e.currentTarget))}
      className="flex flex-col gap-6"
      noValidate={false}
    >
      {budget ? (
        <section className="rounded-lg border border-line bg-canvas p-3" aria-label="Plan budget">
          <BudgetBars budget={budget} currency={budgetCurrency} />
        </section>
      ) : null}

      {draft ? (
        <section className="flex items-center gap-3 rounded-lg border border-signature/40 bg-signature-soft p-3" aria-label="Shared screenshot">
          <input type="hidden" name="draftId" value={draft.id} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={draft.url} alt={draft.filename} className="h-16 w-16 rounded-md object-cover" />
          <div className="min-w-0 text-sm">
            <p className="font-medium">Screenshot ready to attach</p>
            <p className="truncate text-xs text-muted">{draft.filename}</p>
          </div>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Capture">
        <div>
          <label htmlFor="symbol" className="label">
            Symbol
          </label>
          <input
            id="symbol"
            name="symbol"
            defaultValue={symbolDefault}
            required
            maxLength={32}
            autoCapitalize="characters"
            placeholder="AAPL"
            className={`${fieldClass(state, "symbol")} uppercase`}
          />
          <FieldError state={state} name="symbol" />
        </div>
        <div>
          <span className="label">Side</span>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-canvas p-1">
            {(["LONG", "SHORT"] as const).map((side) => (
              <label key={side} className="cursor-pointer">
                <input type="radio" name="side" value={side} defaultChecked={(initial?.side ?? "LONG") === side} className="peer sr-only" />
                <span className="block rounded-md py-1.5 text-center text-sm font-medium text-muted transition-colors peer-checked:bg-surface-3 peer-checked:text-ink peer-focus-visible:ring-2 peer-focus-visible:ring-signature/40">
                  {side === "LONG" ? "Long" : "Short"}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor="quantity" className="label">
            {isOption ? "Contracts" : "Quantity"}
          </label>
          <input
            ref={quantityRef}
            id="quantity"
            name="quantity"
            inputMode="decimal"
            defaultValue={quantityDefault}
            required
            placeholder="100"
            className={fieldClass(state, "quantity")}
          />
          {sizePresets.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1" aria-label="Size presets">
              {sizePresets.map((q) => (
                <button key={q} type="button" className="btn btn-sm" onClick={() => applyPreset(q)}>
                  {q}
                </button>
              ))}
            </div>
          ) : null}
          <FieldError state={state} name="quantity" />
        </div>
        <div>
          <label htmlFor="assetClass" className="label">
            Asset class
          </label>
          <select id="assetClass" name="assetClass" value={assetClass} onChange={(e) => changeAssetClass(e.target.value as (typeof ASSET_CLASSES)[number])} className="input">
            {ASSET_CLASSES.map((c) => (
              <option key={c} value={c}>
                {ASSET_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        {isOption ? (
          <>
            <div>
              <span className="label">Call or put</span>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-canvas p-1">
                {OPTION_TYPES.map((type) => (
                  <label key={type} className="cursor-pointer">
                    <input type="radio" name="optionType" value={type} defaultChecked={optionTypeDefault === type} className="peer sr-only" />
                    <span className="block rounded-md py-1.5 text-center text-sm font-medium text-muted transition-colors peer-checked:bg-surface-3 peer-checked:text-ink peer-focus-visible:ring-2 peer-focus-visible:ring-signature/40">
                      {type === "CALL" ? "Call" : "Put"}
                    </span>
                  </label>
                ))}
              </div>
              <FieldError state={state} name="optionType" />
            </div>
            <div>
              <label htmlFor="strikePrice" className="label">
                Strike
              </label>
              <input id="strikePrice" name="strikePrice" inputMode="decimal" defaultValue={initial?.strikePrice ?? ""} required className={fieldClass(state, "strikePrice")} />
              <FieldError state={state} name="strikePrice" />
            </div>
            <div>
              <label htmlFor="expiresAt" className="label">
                Expiration
              </label>
              <input id="expiresAt" name="expiresAt" type="date" defaultValue={initial?.expiresAt ? expirationKey(initial.expiresAt) : ""} required className={fieldClass(state, "expiresAt")} />
              <FieldError state={state} name="expiresAt" />
            </div>
          </>
        ) : null}
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
          <label htmlFor="stopPrice" className="label">
            Planned stop
          </label>
          <input
            id="stopPrice"
            name="stopPrice"
            inputMode="decimal"
            defaultValue={initial?.stopPrice ?? ""}
            placeholder="Defines 1R"
            className={`${fieldClass(state, "stopPrice")} border-signature/50`}
          />
          <FieldError state={state} name="stopPrice" />
        </div>
        <div className="col-span-2 sm:col-span-1">
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
          <FieldError state={state} name="entryAt" />
        </div>
        <div className="col-span-2 rounded-lg border border-line bg-canvas px-3 py-2 sm:col-span-3">
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
            <p className="text-sm text-muted">{isNew ? "One tap saves an open trade; add the exit and details later." : "Enter quantity and prices"}</p>
          )}
        </div>
      </section>

      <details className="rounded-lg border border-line" open={!isNew}>
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-ink-2 hover:text-ink">More details</summary>
        <div className="flex flex-col gap-6 border-t border-line p-3">
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
              <label htmlFor="multiplier" className="label">
                Multiplier
              </label>
              <input ref={multiplierRef} id="multiplier" name="multiplier" inputMode="decimal" defaultValue={multiplierDefault} className={fieldClass(state, "multiplier")} />
              <p className="hint">{isOption ? "Shares per contract; 100 for standard contracts." : "Point value (futures) or contract size (options)."}</p>
              <FieldError state={state} name="multiplier" />
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
                placeholder="Empty while open"
                className={fieldClass(state, "exitPrice")}
              />
              <FieldError state={state} name="exitPrice" />
            </div>
            <div>
              <label htmlFor="exitAt" className="label">
                Exit time
              </label>
              <input id="exitAt" name="exitAt" type="datetime-local" defaultValue={exitDefault} className={fieldClass(state, "exitAt")} />
              <p className="hint">Defaults to the entry time when an exit price is given.</p>
              <FieldError state={state} name="exitAt" />
            </div>
            <div>
              <label htmlFor="targetPrice" className="label">
                Target price
              </label>
              <input id="targetPrice" name="targetPrice" inputMode="decimal" defaultValue={initial?.targetPrice ?? ""} className={fieldClass(state, "targetPrice")} />
              <FieldError state={state} name="targetPrice" />
            </div>
            <div>
              <label htmlFor="fees" className="label">
                Fees
              </label>
              <input id="fees" name="fees" inputMode="decimal" defaultValue={initial?.fees ?? "0"} className={fieldClass(state, "fees")} />
              <FieldError state={state} name="fees" />
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <div>
              <span className="label">Rating</span>
              <div className="flex gap-1" role="radiogroup" aria-label="Execution rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n} className="cursor-pointer">
                    <input type="radio" name="rating" value={n} defaultChecked={initial?.rating === n} className="peer sr-only" />
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-sm text-muted transition-colors peer-checked:border-signature peer-checked:bg-signature-soft peer-checked:text-ink peer-focus-visible:ring-2 peer-focus-visible:ring-signature/40">
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
                          <span className="chip">
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
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="notes" className="label mb-0">
                  Notes
                </label>
                <DictationButton targetId="notes" />
              </div>
              <textarea
                id="notes"
                name="notes"
                rows={6}
                defaultValue={initial?.notes ?? sharedNote}
                placeholder="Thesis, execution, what you saw. Markdown is supported."
                className={fieldClass(state, "notes")}
              />
              <FieldError state={state} name="notes" />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="mistakes" className="label mb-0">
                  Mistakes
                </label>
                <DictationButton targetId="mistakes" />
              </div>
              <textarea id="mistakes" name="mistakes" rows={2} defaultValue={initial?.mistakes ?? ""} className={fieldClass(state, "mistakes")} />
              <FieldError state={state} name="mistakes" />
            </div>
          </section>
        </div>
      </details>

      {customRules.length > 0 ? (
        <section>
          <span className="label">Rules checked by hand</span>
          <input type="hidden" name="customRuleIds" value={customRules.map((r) => r.id).join(",")} />
          <div className="flex flex-col gap-1.5">
            {customRules.map((rule) => (
              <label key={rule.id} className="flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" name="customFollowed" value={rule.id} defaultChecked={initial ? customFollowedInitial.has(rule.id) : true} />
                {rule.title}
              </label>
            ))}
          </div>
          <p className="hint">Untick a rule you broke on this trade; a justification is then required.</p>
        </section>
      ) : null}

      {showJustification ? (
        <section className="rounded-lg border border-warn/50 bg-surface-2 p-3" aria-label="Rule justification">
          <p className="text-sm font-semibold text-warn">This trade breaks {brokenFromState.length || brokenInitial.length} rule{(brokenFromState.length || brokenInitial.length) === 1 ? "" : "s"}</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink-2">
            {(brokenFromState.length ? brokenFromState.map((b) => ({ key: b.ruleId, title: b.title, detail: b.detail })) : brokenInitial.map((e) => ({ key: e.ruleId, title: e.ruleTitle, detail: "" }))).map((b) => (
              <li key={b.key}>
                {b.title}
                {b.detail ? <span className="text-muted"> — {b.detail}</span> : null}
              </li>
            ))}
          </ul>
          <label htmlFor="justification" className="label mt-3">
            Justification (one line)
          </label>
          <input
            id="justification"
            name="justification"
            maxLength={300}
            defaultValue={initialJustification}
            placeholder="Why was this acceptable?"
            className={fieldClass(state, "justification")}
          />
          <FieldError state={state} name="justification" />
          <label className="mt-2 flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" name="overridden" defaultChecked={initialOverridden} /> Deliberate exception, not a lapse
          </label>
        </section>
      ) : null}

      <FormMessage state={state} />
      <div className="flex items-center gap-3">
        <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
