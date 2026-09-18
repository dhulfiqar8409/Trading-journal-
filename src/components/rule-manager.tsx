"use client";

import { useState } from "react";
import { createRuleAction, deleteRuleAction, toggleRuleAction, updateRuleAction } from "@/actions/rules";
import { ConfirmSubmit } from "@/components/confirm-button";
import { FieldError, FormMessage, SubmitButton, fieldClass, useActionForm } from "@/components/forms";
import type { ActionState } from "@/lib/form";
import { RULE_KIND_INFO, RULE_KINDS, describeRule, type RuleKind } from "@/lib/rules";
import type { RuleDTO } from "@/lib/serialize";

export interface RulePrefill {
  kind?: string;
  value?: string;
  timeValue?: string;
  title?: string;
}

function RuleFields({ state, initial, prefill, idPrefix }: { state: ActionState; initial?: RuleDTO; prefill?: RulePrefill; idPrefix: string }) {
  const initialKind = (initial?.kind ?? (RULE_KINDS.includes(prefill?.kind as RuleKind) ? (prefill?.kind as RuleKind) : "MAX_TRADES_PER_DAY")) as RuleKind;
  const [kind, setKind] = useState<RuleKind>(initialKind);
  const info = RULE_KIND_INFO[kind];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
      <div>
        <label htmlFor={`${idPrefix}-kind`} className="label">
          Kind
        </label>
        <select id={`${idPrefix}-kind`} name="kind" value={kind} onChange={(e) => setKind(e.target.value as RuleKind)} className="input">
          {RULE_KINDS.map((k) => (
            <option key={k} value={k}>
              {RULE_KIND_INFO[k].label}
            </option>
          ))}
        </select>
        <p className="hint">{info.description}</p>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-title`} className="label">
          Title
        </label>
        <input
          id={`${idPrefix}-title`}
          name="title"
          defaultValue={initial?.title ?? prefill?.title ?? ""}
          placeholder={info.defaultTitle || "e.g. Wait for the setup"}
          required
          maxLength={80}
          className={fieldClass(state, "title")}
        />
        <FieldError state={state} name="title" />
      </div>
      <div className="min-w-32">
        {info.parameter === "number" ? (
          <>
            <label htmlFor={`${idPrefix}-value`} className="label">
              Limit{info.unit ? ` (${info.unit})` : ""}
            </label>
            <input id={`${idPrefix}-value`} name="value" inputMode="decimal" defaultValue={initial?.value ?? prefill?.value ?? ""} className={fieldClass(state, "value")} />
            <FieldError state={state} name="value" />
          </>
        ) : info.parameter === "time" ? (
          <>
            <label htmlFor={`${idPrefix}-time`} className="label">
              Time
            </label>
            <input id={`${idPrefix}-time`} name="timeValue" type="time" defaultValue={initial?.timeValue ?? prefill?.timeValue ?? ""} className={fieldClass(state, "timeValue")} />
            <FieldError state={state} name="timeValue" />
          </>
        ) : (
          <>
            <span className="label">Limit</span>
            <p className="py-2 text-sm text-muted">—</p>
          </>
        )}
      </div>
      <input type="hidden" name="active" value={initial ? (initial.active ? "on" : "") : "on"} />
    </div>
  );
}

export function NewRuleForm({ prefill }: { prefill?: RulePrefill }) {
  const { state, onSubmit, pending } = useActionForm(createRuleAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <RuleFields state={state} prefill={prefill} idPrefix="new" />
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingText="Adding…" pending={pending}>Add rule</SubmitButton>
      </div>
    </form>
  );
}

export function RuleRow({ rule, eventCount, brokenCount }: { rule: RuleDTO; eventCount: number; brokenCount: number }) {
  const [editing, setEditing] = useState(false);
  const { state, onSubmit, pending } = useActionForm(updateRuleAction.bind(null, rule.id));
  const toggle = toggleRuleAction.bind(null, rule.id);
  const remove = deleteRuleAction.bind(null, rule.id);
  const info = RULE_KIND_INFO[rule.kind];
  const param = describeRule({ kind: rule.kind, value: rule.value, timeValue: rule.timeValue });

  if (editing) {
    return (
      <li className="rounded-lg border border-line bg-canvas p-3">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <RuleFields state={state} initial={rule} idPrefix={rule.id} />
          <FormMessage state={state} />
          <div className="flex gap-2">
            <SubmitButton className="btn btn-primary btn-sm" pending={pending}>Save</SubmitButton>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }
  return (
    <li className={`flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between ${rule.active ? "" : "opacity-60"}`}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {rule.title}
          <span className="badge">{info.label}{param ? ` · ${param}` : ""}</span>
          {!rule.active ? <span className="badge">Paused</span> : null}
        </p>
        <p className="text-xs text-muted">
          Checked on {eventCount} trade{eventCount === 1 ? "" : "s"} · broken {brokenCount} time{brokenCount === 1 ? "" : "s"}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <form action={toggle}>
          <button type="submit" className="btn btn-sm">
            {rule.active ? "Pause" : "Resume"}
          </button>
        </form>
        <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
          Edit
        </button>
        <form action={remove}>
          <ConfirmSubmit message={`Delete rule "${rule.title}" and its ${eventCount} recorded checks?`} className="btn btn-sm btn-danger">
            Delete
          </ConfirmSubmit>
        </form>
      </div>
    </li>
  );
}
