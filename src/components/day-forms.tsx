"use client";

import { saveCheckInAction, saveReviewAction } from "@/actions/days";
import { justifyEventAction } from "@/actions/rules";
import { DictationButton } from "@/components/dictation";
import { FieldError, FormMessage, SubmitButton, fieldClass, useActionForm } from "@/components/forms";
import type { DayDTO, TagDTO } from "@/lib/serialize";

function Scale({ name, label, value, low, high }: { name: string; label: string; value: number | null; low: string; high: string }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer">
            <input type="radio" name={name} value={n} defaultChecked={value === n} className="peer sr-only" />
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-sm text-muted transition-colors peer-checked:border-signature peer-checked:bg-signature-soft peer-checked:text-ink peer-focus-visible:ring-2 peer-focus-visible:ring-signature/40">
              {n}
            </span>
          </label>
        ))}
      </div>
      <p className="hint">
        1 = {low}, 5 = {high}
      </p>
    </div>
  );
}

export function CheckInForm({ dateKey, day, setups }: { dateKey: string; day: DayDTO | null; setups: TagDTO[] }) {
  const { state, onSubmit, pending } = useActionForm(saveCheckInAction);
  const allowed = new Set(day?.allowedSetupIds ?? []);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="date" value={dateKey} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ci-maxTrades" className="label">
            Max trades
          </label>
          <input id="ci-maxTrades" name="maxTrades" type="number" min={0} inputMode="numeric" defaultValue={day?.maxTrades ?? ""} className={fieldClass(state, "maxTrades")} />
          <FieldError state={state} name="maxTrades" />
        </div>
        <div>
          <label htmlFor="ci-maxLossR" className="label">
            Max loss (R)
          </label>
          <input id="ci-maxLossR" name="maxLossR" inputMode="decimal" defaultValue={day?.maxLossR ?? ""} className={fieldClass(state, "maxLossR")} />
          <FieldError state={state} name="maxLossR" />
        </div>
      </div>
      <div>
        <span className="label">Allowed setups</span>
        {setups.length === 0 ? (
          <p className="text-sm text-muted">No setup tags yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {setups.map((tag) => (
              <label key={tag.id} className="cursor-pointer">
                <input type="checkbox" name="allowedSetupIds" value={tag.id} defaultChecked={allowed.has(tag.id)} className="peer sr-only" />
                <span className="chip">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden />
                  {tag.name}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor="ci-focusNote" className="label mb-0">
            Focus for the day
          </label>
          <DictationButton targetId="ci-focusNote" />
        </div>
        <textarea id="ci-focusNote" name="focusNote" rows={2} defaultValue={day?.focusNote ?? ""} placeholder="One thing to do well today" className={fieldClass(state, "focusNote")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Scale name="mood" label="Mood" value={day?.mood ?? null} low="low" high="great" />
        <Scale name="focus" label="Focus" value={day?.focus ?? null} low="scattered" high="sharp" />
        <Scale name="energy" label="Energy" value={day?.energy ?? null} low="drained" high="charged" />
        <div>
          <label htmlFor="ci-sleep" className="label">
            Sleep (hours)
          </label>
          <input id="ci-sleep" name="sleepHours" type="number" step={0.5} min={0} max={24} inputMode="decimal" defaultValue={day?.sleepHours ?? ""} className={fieldClass(state, "sleepHours")} />
          <FieldError state={state} name="sleepHours" />
        </div>
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton pending={pending}>{day?.checkedInAt ? "Update check-in" : "Save check-in"}</SubmitButton>
      </div>
    </form>
  );
}

export function ReviewForm({ dateKey, day }: { dateKey: string; day: DayDTO | null }) {
  const { state, onSubmit, pending } = useActionForm(saveReviewAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="date" value={dateKey} />
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor="rv-right" className="label mb-0">
            What went right?
          </label>
          <DictationButton targetId="rv-right" />
        </div>
        <textarea id="rv-right" name="wentRight" rows={2} defaultValue={day?.wentRight ?? ""} className={fieldClass(state, "wentRight")} />
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor="rv-wrong" className="label mb-0">
            What went wrong?
          </label>
          <DictationButton targetId="rv-wrong" />
        </div>
        <textarea id="rv-wrong" name="wentWrong" rows={2} defaultValue={day?.wentWrong ?? ""} className={fieldClass(state, "wentWrong")} />
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label htmlFor="rv-change" className="label mb-0">
            One change for tomorrow
          </label>
          <DictationButton targetId="rv-change" />
        </div>
        <textarea id="rv-change" name="oneChange" rows={2} defaultValue={day?.oneChange ?? ""} className={fieldClass(state, "oneChange")} />
      </div>
      <div>
        <label htmlFor="rv-tags" className="label">
          Day tags
        </label>
        <input id="rv-tags" name="dayTags" defaultValue={day?.dayTags.join(", ") ?? ""} placeholder="e.g. FOMC, sick, travel" className="input" />
        <p className="hint">Comma separated.</p>
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton pending={pending}>{day?.reviewedAt ? "Update review" : "Save review"}</SubmitButton>
      </div>
    </form>
  );
}

export function JustifyForm({ eventId }: { eventId: string }) {
  const { state, onSubmit, pending } = useActionForm(justifyEventAction.bind(null, eventId));
  return (
    <form onSubmit={onSubmit} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex-1">
        <label htmlFor={`j-${eventId}`} className="sr-only">
          Justification
        </label>
        <input id={`j-${eventId}`} name="justification" maxLength={300} placeholder="Why was this acceptable?" className={fieldClass(state, "justification")} />
        <FieldError state={state} name="justification" />
      </div>
      <label className="flex items-center gap-2 text-xs text-ink-2">
        <input type="checkbox" name="overridden" /> Deliberate exception
      </label>
      <SubmitButton className="btn btn-sm" pending={pending}>Save</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
