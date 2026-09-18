"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { closeTradeAction } from "@/actions/trades";
import { FieldError, FormMessage, SubmitButton, fieldClass, useActionForm } from "@/components/forms";
import { planClose } from "@/lib/close";
import type { CloseTarget } from "@/lib/close-target";
import { formatMoney, formatNumber, formatR } from "@/lib/format";
import { expirationCloseTime } from "@/lib/options";
import { computeTradeMetrics } from "@/lib/pnl";
import { toDateTimeLocalValue } from "@/lib/tz";

const NUM = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;

interface Preview {
  pnl: string | null;
  r: string | null;
  quantity: string;
  partial: boolean;
}

function previewFrom(form: HTMLFormElement, trade: CloseTarget): Preview | null {
  const fd = new FormData(form);
  const get = (k: string) => String(fd.get(k) ?? "").trim();
  const quantity = get("closeQuantity");
  const exitPrice = get("exitPrice");
  const extraFees = get("extraFees");
  if (!NUM.test(quantity)) return null;
  try {
    const plan = planClose({ quantity: trade.quantity, fees: trade.fees }, { closeQuantity: quantity, extraFees: NUM.test(extraFees) ? extraFees : null });
    if (!plan.ok) return null;
    const closed = plan.plan.closed;
    const metrics = NUM.test(exitPrice)
      ? computeTradeMetrics({ side: trade.side, quantity: closed.quantity, entryPrice: trade.entryPrice, exitPrice, multiplier: trade.multiplier, fees: closed.fees, stopPrice: trade.stopPrice })
      : null;
    return { pnl: metrics?.pnl ? metrics.pnl.toFixed() : null, r: metrics?.rMultiple ? metrics.rMultiple.toFixed() : null, quantity: closed.quantity, partial: plan.plan.kind === "partial" };
  } catch {
    return null;
  }
}

/**
 * "Close" for an open trade: a bottom sheet with the closing fill (price,
 * time, extra fees, note) and the quantity to close, which splits the trade
 * when it is less than the open quantity. Option trades also get "Expired
 * worthless", which closes the whole position at zero on expiration day.
 */
export function CloseTrade({ trade, timeZone, primary = false, className }: { trade: CloseTarget; timeZone: string; primary?: boolean; className?: string }) {
  const [open, setOpen] = useState<null | "close" | "expired">(null);
  const isOption = trade.assetClass === "OPTION" && trade.expiresAt !== null;
  const stop = (e: React.MouseEvent) => {
    // The button often sits inside a link to the trade; the tap must not follow it.
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={className ?? (primary ? "btn btn-primary" : "btn btn-sm")}
          onClick={(e) => {
            stop(e);
            setOpen("close");
          }}
        >
          Close
        </button>
        {isOption ? (
          <button
            type="button"
            className={primary ? "btn" : "btn btn-sm"}
            onClick={(e) => {
              stop(e);
              setOpen("expired");
            }}
          >
            Expired worthless
          </button>
        ) : null}
      </span>
      {open ? <CloseSheet trade={trade} timeZone={timeZone} expired={open === "expired"} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function CloseSheet({ trade, timeZone, expired, onClose }: { trade: CloseTarget; timeZone: string; expired: boolean; onClose: () => void }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const { state, onSubmit, pending } = useActionForm(closeTradeAction.bind(null, trade.id));
  const [preview, setPreview] = useState<Preview | null>(null);
  const brokenRules = state && !state.ok ? (state.brokenRules ?? []) : [];
  const exitDefault = expired && trade.expiresAt ? toDateTimeLocalValue(expirationCloseTime(trade.expiresAt, timeZone), timeZone) : toDateTimeLocalValue(new Date(), timeZone);
  const entryMin = toDateTimeLocalValue(new Date(trade.entryAt), timeZone);

  useEffect(() => {
    if (formRef.current) setPreview(previewFrom(formRef.current, trade));
  }, [trade]);

  // "Expired worthless" is one tap: the sheet opens filled in and submits itself; it only stays open when a rule needs a justification.
  useEffect(() => {
    if (expired && formRef.current) formRef.current.requestSubmit();
  }, [expired]);

  useEffect(() => {
    if (state?.ok) {
      onClose();
      router.refresh();
    }
  }, [state, onClose, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const partial = preview?.partial ?? false;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Close ${trade.label}`}>
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Cancel" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Close {trade.label}</p>
            <p className="num text-xs text-muted">
              {trade.side === "LONG" ? "Long" : "Short"} {formatNumber(trade.quantity, 8)} @ {trade.entryPrice}
              {trade.stopPrice ? ` · stop ${trade.stopPrice}` : ""}
            </p>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Cancel
          </button>
        </div>
        <form ref={formRef} onSubmit={onSubmit} onChange={(e) => setPreview(previewFrom(e.currentTarget, trade))} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="close-quantity" className="label">
                Quantity to close
              </label>
              <input id="close-quantity" name="closeQuantity" inputMode="decimal" defaultValue={trade.quantity} required className={fieldClass(state, "closeQuantity")} />
              <p className="hint">of {formatNumber(trade.quantity, 8)} open</p>
              <FieldError state={state} name="closeQuantity" />
            </div>
            <div>
              <label htmlFor="close-exitPrice" className="label">
                Exit price
              </label>
              <input id="close-exitPrice" name="exitPrice" inputMode="decimal" defaultValue={expired ? "0" : ""} required autoFocus={!expired} className={fieldClass(state, "exitPrice")} />
              <FieldError state={state} name="exitPrice" />
            </div>
            <div className="col-span-2">
              <label htmlFor="close-exitAt" className="label">
                Exit time
              </label>
              <input id="close-exitAt" name="exitAt" type="datetime-local" defaultValue={exitDefault} min={entryMin} required className={fieldClass(state, "exitAt")} />
              <FieldError state={state} name="exitAt" />
            </div>
            <div>
              <label htmlFor="close-extraFees" className="label">
                Extra fees
              </label>
              <input id="close-extraFees" name="extraFees" inputMode="decimal" placeholder="0" className={fieldClass(state, "extraFees")} />
              <p className="hint">Added to the trade&apos;s fees</p>
              <FieldError state={state} name="extraFees" />
            </div>
            <div className="rounded-lg border border-line bg-canvas px-3 py-2">
              <p className="text-xs text-muted">Result</p>
              {preview && preview.pnl !== null ? (
                <p className={`num text-sm ${Number(preview.pnl) > 0 ? "text-profit" : Number(preview.pnl) < 0 ? "text-loss" : ""}`}>
                  {formatMoney(preview.pnl, { currency: trade.currency, signed: true })}
                  {preview.r !== null ? <span className="text-muted"> · {formatR(preview.r)}</span> : null}
                </p>
              ) : (
                <p className="text-sm text-muted">Enter the exit price</p>
              )}
            </div>
            <div className="col-span-2">
              <label htmlFor="close-exitNote" className="label">
                Exit note <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea id="close-exitNote" name="exitNote" rows={2} placeholder="Appended to the notes" className={fieldClass(state, "exitNote")} />
              <FieldError state={state} name="exitNote" />
            </div>
          </div>
          {partial ? (
            <p className="text-xs text-ink-2">
              Closing {formatNumber(preview?.quantity ?? "", 8)} of {formatNumber(trade.quantity, 8)}: the closed part becomes its own trade and the rest stays open.
            </p>
          ) : null}
          {brokenRules.length ? (
            <section className="rounded-lg border border-warn/50 bg-surface-2 p-3" aria-label="Rule justification">
              <p className="text-sm font-semibold text-warn">
                Closing breaks {brokenRules.length} rule{brokenRules.length === 1 ? "" : "s"}
              </p>
              <ul className="mt-1 list-disc pl-5 text-sm text-ink-2">
                {brokenRules.map((b) => (
                  <li key={b.ruleId}>
                    {b.title}
                    {b.detail ? <span className="text-muted"> — {b.detail}</span> : null}
                  </li>
                ))}
              </ul>
              <label htmlFor="close-justification" className="label mt-3">
                Justification (one line)
              </label>
              <input id="close-justification" name="justification" maxLength={300} placeholder="Why was this acceptable?" className={fieldClass(state, "justification")} />
              <FieldError state={state} name="justification" />
              <label className="mt-2 flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" name="overridden" /> Deliberate exception, not a lapse
              </label>
            </section>
          ) : null}
          <FormMessage state={state} />
          <div className="flex items-center gap-2">
            <SubmitButton pending={pending} pendingText="Closing…">
              {partial ? `Close ${formatNumber(preview?.quantity ?? "", 8)} of ${formatNumber(trade.quantity, 8)}` : "Close trade"}
            </SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
