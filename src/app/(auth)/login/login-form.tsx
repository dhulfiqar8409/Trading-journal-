"use client";

import { loginAction } from "@/actions/auth";
import { FormMessage, SubmitButton, useActionForm } from "@/components/forms";

export function LoginForm({ next }: { next?: string }) {
  const { state, onSubmit, pending } = useActionForm(loginAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div>
        <label htmlFor="identifier" className="label">
          Username
        </label>
        <input
          id="identifier"
          name="identifier"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          className="input"
        />
        <p className="hint">Your account&apos;s email works here too.</p>
      </div>
      <div>
        <label htmlFor="password" className="label">
          Password
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingText="Signing in…" pending={pending}>Sign in</SubmitButton>
    </form>
  );
}
