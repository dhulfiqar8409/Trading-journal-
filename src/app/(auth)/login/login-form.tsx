"use client";

import { useActionState } from "react";
import { loginAction } from "@/actions/auth";
import { FormMessage, SubmitButton } from "@/components/forms";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(loginAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div>
        <label htmlFor="email" className="label">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required className="input" />
      </div>
      <div>
        <label htmlFor="password" className="label">
          Password
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
