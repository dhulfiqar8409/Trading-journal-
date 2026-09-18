"use client";

import { setupAction } from "@/actions/auth";
import { FieldError, FormMessage, SubmitButton, fieldClass, useActionForm } from "@/components/forms";
import { TimeZoneSelect } from "@/components/timezone-select";

export function SetupForm({ token }: { token?: string }) {
  const { state, onSubmit, pending } = useActionForm(setupAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {token ? <input type="hidden" name="token" value={token} /> : null}
      <div>
        <label htmlFor="name" className="label">
          Name
        </label>
        <input id="name" name="name" autoComplete="name" required className={fieldClass(state, "name")} />
        <FieldError state={state} name="name" />
      </div>
      <div>
        <label htmlFor="email" className="label">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required className={fieldClass(state, "email")} />
        <FieldError state={state} name="email" />
      </div>
      <div>
        <label htmlFor="password" className="label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          className={fieldClass(state, "password")}
        />
        <p className="hint">At least 10 characters.</p>
        <FieldError state={state} name="password" />
      </div>
      <div>
        <label htmlFor="confirmPassword" className="label">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className={fieldClass(state, "confirmPassword")}
        />
        <FieldError state={state} name="confirmPassword" />
      </div>
      <div>
        <label htmlFor="timeZone" className="label">
          Time zone
        </label>
        <TimeZoneSelect id="timeZone" name="timeZone" />
        <p className="hint">Trade times are shown and entered in this zone. Change it later in Settings.</p>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingText="Creating…" pending={pending}>Create account</SubmitButton>
    </form>
  );
}
