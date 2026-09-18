"use client";

import { changePasswordAction, updateProfileAction } from "@/actions/auth";
import { FieldError, FormMessage, SubmitButton, fieldClass, useActionForm } from "@/components/forms";
import { TimeZoneSelect } from "@/components/timezone-select";
import { PASSWORD_HINT, PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from "@/lib/users";

export function ProfileForm({ name, timeZone, displayMode }: { name: string; timeZone: string; displayMode: "R" | "USD" }) {
  const { state, onSubmit, pending } = useActionForm(updateProfileAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div>
        <label htmlFor="p-name" className="label">
          Name
        </label>
        <input id="p-name" name="name" defaultValue={name} required maxLength={100} className={fieldClass(state, "name")} />
        <FieldError state={state} name="name" />
      </div>
      <div>
        <label htmlFor="p-tz" className="label">
          Time zone
        </label>
        <TimeZoneSelect id="p-tz" name="timeZone" defaultValue={timeZone} />
        <p className="hint">Trade times, daily P&L and the calendar use this zone.</p>
        <FieldError state={state} name="timeZone" />
      </div>
      <div>
        <label htmlFor="p-mode" className="label">
          Show results in
        </label>
        <select id="p-mode" name="displayMode" defaultValue={displayMode} className="input">
          <option value="R">R-multiples first (dollars one tap away)</option>
          <option value="USD">Currency first (R one tap away)</option>
        </select>
        <p className="hint">R needs a stop on the trade; trades without one show “no stop” and stay out of R statistics.</p>
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton pending={pending}>Save settings</SubmitButton>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const { state, onSubmit, pending } = useActionForm(changePasswordAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div>
        <label htmlFor="cp-current" className="label">
          Current password
        </label>
        <input id="cp-current" name="currentPassword" type="password" autoComplete="current-password" required className={fieldClass(state, "currentPassword")} />
        <FieldError state={state} name="currentPassword" />
      </div>
      <div>
        <label htmlFor="cp-new" className="label">
          New password
        </label>
        <input
          id="cp-new"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_BYTES}
          required
          className={fieldClass(state, "newPassword")}
        />
        <p className="hint">{PASSWORD_HINT}</p>
        <FieldError state={state} name="newPassword" />
      </div>
      <div>
        <label htmlFor="cp-confirm" className="label">
          Confirm new password
        </label>
        <input id="cp-confirm" name="confirmPassword" type="password" autoComplete="new-password" required className={fieldClass(state, "confirmPassword")} />
        <FieldError state={state} name="confirmPassword" />
      </div>
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingText="Updating…" pending={pending}>Change password</SubmitButton>
      </div>
    </form>
  );
}
