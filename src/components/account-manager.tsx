"use client";

import { useActionState, useState } from "react";
import { createAccountAction, deleteAccountAction, updateAccountAction } from "@/actions/accounts";
import { FieldError, FormMessage, SubmitButton, fieldClass } from "@/components/forms";
import type { ActionState } from "@/lib/form";

export interface AccountRowData {
  id: string;
  name: string;
  broker: string | null;
  currency: string;
  isDefault: boolean;
  tradeCount: number;
}

function AccountFields({ state, initial, idPrefix }: { state: ActionState; initial?: AccountRowData; idPrefix: string }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
      <div className="col-span-2 sm:col-span-1">
        <label htmlFor={`${idPrefix}-name`} className="label">
          Name
        </label>
        <input id={`${idPrefix}-name`} name="name" defaultValue={initial?.name ?? ""} required maxLength={60} className={fieldClass(state, "name")} />
        <FieldError state={state} name="name" />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <label htmlFor={`${idPrefix}-broker`} className="label">
          Broker
        </label>
        <input id={`${idPrefix}-broker`} name="broker" defaultValue={initial?.broker ?? ""} maxLength={60} className="input" placeholder="Optional" />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-currency`} className="label">
          Currency
        </label>
        <input
          id={`${idPrefix}-currency`}
          name="currency"
          defaultValue={initial?.currency ?? "USD"}
          maxLength={3}
          className={`${fieldClass(state, "currency")} w-24 uppercase`}
        />
        <FieldError state={state} name="currency" />
      </div>
      <div className="flex items-end pb-2">
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" name="isDefault" defaultChecked={initial?.isDefault ?? false} /> Default
        </label>
      </div>
    </div>
  );
}

export function NewAccountForm() {
  const [state, action] = useActionState(createAccountAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <AccountFields state={state} idPrefix="new" />
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingText="Creating…">Add account</SubmitButton>
      </div>
    </form>
  );
}

export function AccountRow({ account }: { account: AccountRowData }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState(updateAccountAction.bind(null, account.id), null);
  const [deleteState, deleteAction] = useActionState(deleteAccountAction.bind(null, account.id), null);

  if (editing) {
    return (
      <li className="rounded-lg border border-line bg-canvas p-3">
        <form action={action} className="flex flex-col gap-2">
          <AccountFields state={state} initial={account} idPrefix={account.id} />
          <FormMessage state={state} />
          <div className="flex gap-2">
            <SubmitButton className="btn btn-primary btn-sm">Save</SubmitButton>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="flex items-center gap-2 font-medium">
          {account.name}
          {account.isDefault ? <span className="badge">Default</span> : null}
        </p>
        <p className="text-xs text-muted">
          {account.broker ? `${account.broker} · ` : ""}
          {account.currency} · {account.tradeCount} trade{account.tradeCount === 1 ? "" : "s"}
        </p>
        <FormMessage state={deleteState} />
      </div>
      <div className="flex items-center gap-1">
        <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
          Edit
        </button>
        <form action={deleteAction}>
          <button
            type="submit"
            className="btn btn-sm btn-danger"
            disabled={account.tradeCount > 0}
            title={account.tradeCount > 0 ? "Accounts with trades cannot be deleted" : undefined}
            onClick={(e) => {
              if (!window.confirm(`Delete account "${account.name}"?`)) e.preventDefault();
            }}
          >
            Delete
          </button>
        </form>
      </div>
    </li>
  );
}
