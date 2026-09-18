"use client";

import { changePasswordAction, updateProfileAction } from "@/actions/auth";
import { FieldError, FormMessage, SubmitButton, fieldClass, useActionForm } from "@/components/forms";
import { TimeZoneSelect } from "@/components/timezone-select";

export function ProfileForm({ name, timeZone }: { name: string; timeZone: string }) {
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
        <input id="cp-new" name="newPassword" type="password" autoComplete="new-password" minLength={10} required className={fieldClass(state, "newPassword")} />
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
