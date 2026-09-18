"use client";

import { startTransition, useActionState, useCallback } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/form";

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Runs a server action from a form's submit event instead of the form's
 * `action` prop. React resets an uncontrolled form after an `action` prop
 * finishes, which wipes the fields when validation fails; invoking the action
 * manually keeps what the owner typed.
 */
export function useActionForm(action: FormAction) {
  const [state, formAction, pending] = useActionState(action, null);
  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      startTransition(() => formAction(formData));
    },
    [formAction],
  );
  return { state, onSubmit, pending };
}

export function SubmitButton({
  children,
  pendingText = "Saving…",
  className = "btn btn-primary",
  pending: pendingProp,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  /** Pass the pending flag from useActionForm; forms that use the action prop can rely on useFormStatus. */
  pending?: boolean;
}) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.ok) {
    if (!state.message) return null;
    return (
      <p role="status" className="rounded-lg border border-profit-mark/40 bg-profit-soft px-3 py-2 text-sm text-profit">
        {state.message}
      </p>
    );
  }
  return (
    <p role="alert" className="rounded-lg border border-loss-mark/40 bg-loss-soft px-3 py-2 text-sm text-loss">
      {state.error}
    </p>
  );
}

export function FieldError({ state, name }: { state: ActionState; name: string }) {
  if (!state || state.ok) return null;
  const message = state.fieldErrors?.[name];
  if (!message) return null;
  return <p className="mt-1 text-xs text-loss">{message}</p>;
}

export function fieldClass(state: ActionState, name: string, base = "input"): string {
  return state && !state.ok && state.fieldErrors?.[name] ? `${base} input-error` : base;
}
