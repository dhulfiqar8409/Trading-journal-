"use client";

import { setupAction } from "@/actions/auth";
import { FieldError, FormMessage, SubmitButton, fieldClass, useActionForm } from "@/components/forms";
import { TimeZoneSelect } from "@/components/timezone-select";
import { PASSWORD_HINT, PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, USERNAME_HINT } from "@/lib/users";

export function SetupForm({ token }: { token?: string }) {
  const { state, onSubmit, pending } = useActionForm(setupAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {token ? <input type="hidden" name="token" value={token} /> : null}
      <div>
        <label htmlFor="username" className="label">
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          minLength={3}
          maxLength={32}
          className={fieldClass(state, "username")}
        />
        <p className="hint">{USERNAME_HINT} Used to sign in.</p>
        <FieldError state={state} name="username" />
      </div>
      <div>
        <label htmlFor="name" className="label">
          Display name
        </label>
        <input id="name" name="name" autoComplete="name" required maxLength={100} className={fieldClass(state, "name")} />
        <FieldError state={state} name="name" />
      </div>
      <div>
        <label htmlFor="email" className="label">
          Email <span className="font-normal text-muted">(optional)</span>
        </label>
        <input id="email" name="email" type="email" autoComplete="email" className={fieldClass(state, "email")} />
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
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_BYTES}
          required
          className={fieldClass(state, "password")}
        />
        <p className="hint">{PASSWORD_HINT}</p>
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
      <SubmitButton pendingText="Creating…" pending={pending}>Create admin account</SubmitButton>
    </form>
  );
}
