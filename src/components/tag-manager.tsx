"use client";

import { useActionState, useState } from "react";
import { createTagAction, deleteTagAction, updateTagAction } from "@/actions/tags";
import { ConfirmSubmit } from "@/components/confirm-button";
import { FieldError, FormMessage, SubmitButton, fieldClass } from "@/components/forms";
import { TAG_KIND_LABELS, TagChip } from "@/components/tag-chip";
import type { TagDTO } from "@/lib/serialize";
import { TAG_KINDS } from "@/lib/validation";

const PALETTE = ["#3987e5", "#12a884", "#ea5a3a", "#e0a534", "#9085e9", "#d55181", "#199e70", "#6b7280"];

function TagFields({ state, initial, idPrefix }: { state: Parameters<typeof FieldError>[0]["state"]; initial?: TagDTO; idPrefix: string }) {
  const [color, setColor] = useState(initial?.color ?? PALETTE[0]);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto]">
      <div className="col-span-2 sm:col-span-1">
        <label htmlFor={`${idPrefix}-name`} className="sr-only">
          Name
        </label>
        <input
          id={`${idPrefix}-name`}
          name="name"
          defaultValue={initial?.name ?? ""}
          placeholder="Tag name"
          required
          maxLength={40}
          className={fieldClass(state, "name")}
        />
        <FieldError state={state} name="name" />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-kind`} className="sr-only">
          Kind
        </label>
        <select id={`${idPrefix}-kind`} name="kind" defaultValue={initial?.kind ?? "SETUP"} className="input">
          {TAG_KINDS.map((k) => (
            <option key={k} value={k}>
              {TAG_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <input type="hidden" name="color" value={color} />
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Colour ${c}`}
            aria-pressed={color === c}
            onClick={() => setColor(c)}
            className={`h-6 w-6 rounded-full border-2 ${color === c ? "border-ink" : "border-transparent"}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}

export function NewTagForm() {
  const [state, action] = useActionState(createTagAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <TagFields state={state} idPrefix="new" />
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingText="Creating…">Add tag</SubmitButton>
      </div>
    </form>
  );
}

export function TagRow({ tag, tradeCount }: { tag: TagDTO; tradeCount: number }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState(updateTagAction.bind(null, tag.id), null);
  const remove = deleteTagAction.bind(null, tag.id);

  if (editing) {
    return (
      <li className="rounded-lg border border-line bg-canvas p-3">
        <form action={action} className="flex flex-col gap-2">
          <TagFields state={state} initial={tag} idPrefix={tag.id} />
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
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <TagChip tag={tag} />
        <span className="text-xs text-muted">
          {tradeCount} trade{tradeCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
          Edit
        </button>
        <form action={remove}>
          <ConfirmSubmit message={`Delete tag "${tag.name}"? It will be removed from ${tradeCount} trade${tradeCount === 1 ? "" : "s"}.`} className="btn btn-sm btn-danger">
            Delete
          </ConfirmSubmit>
        </form>
      </div>
    </li>
  );
}
