"use client";

import { changePasswordAction } from "@/actions/auth";
import { FieldError, FormMessage, SubmitButton, fieldClass, useActionForm } from "@/components/forms";

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const { state, onSubmit, pending } = useActionForm(changePasswordAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <label htmlFor="currentPassword" className="label">
          {forced ? "Temporary password" : "Current password"}
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className={fieldClass(state, "currentPassword")}
        />
        <FieldError state={state} name="currentPassword" />
      </div>
      <div>
        <label htmlFor="newPassword" className="label">
          New password
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          className={fieldClass(state, "newPassword")}
        />
        <p className="hint">At least 10 characters.</p>
        <FieldError state={state} name="newPassword" />
      </div>
      <div>
        <label htmlFor="confirmPassword" className="label">
          Confirm new password
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
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…" pending={pending}>
        {forced ? "Set password and continue" : "Change password"}
      </SubmitButton>
    </form>
  );
}
