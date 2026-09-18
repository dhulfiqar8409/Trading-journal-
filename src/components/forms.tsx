"use client";

import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/form";

export function SubmitButton({
  children,
  pendingText = "Saving…",
  className = "btn btn-primary",
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
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
