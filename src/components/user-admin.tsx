"use client";

import { useState } from "react";
import { createUserAction, deleteUserAction, resetPasswordAction, setActiveAction, setRoleAction } from "@/actions/admin";
import { ConfirmSubmit } from "@/components/confirm-button";
import { CopyField } from "@/components/copy-field";
import { FieldError, FormMessage, SubmitButton, fieldClass, useActionForm } from "@/components/forms";
import type { ActionState } from "@/lib/form";
import { USERNAME_HINT } from "@/lib/users";

export interface AdminUserDTO {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: "ADMIN" | "USER";
  isActive: boolean;
  mustChangePassword: boolean;
  lastLogin: string | null;
  created: string;
  tradeCount: number;
}

/** The generated or typed temporary password, rendered once from the action's response and never stored. */
function OneTimePassword({ state }: { state: ActionState }) {
  if (!state?.ok || !state.data?.temporaryPassword) return null;
  return (
    <div role="status" className="rounded-lg border border-signature/40 bg-signature-soft p-3">
      <p className="text-sm font-medium">Temporary password for @{state.data.username}</p>
      <p className="mb-2 text-xs text-muted">Shown once. Pass it on; it stops working as soon as they choose their own.</p>
      <CopyField value={state.data.temporaryPassword} label="Temporary password" />
    </div>
  );
}

export function CreateUserForm() {
  const { state, onSubmit, pending } = useActionForm(createUserAction);
  // After a success the fields remount (clean form) while the one-time password stays on screen.
  const [tracked, setTracked] = useState<{ state: ActionState; version: number }>({ state: null, version: 0 });
  if (tracked.state !== state) setTracked({ state, version: state?.ok ? tracked.version + 1 : tracked.version });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <CreateUserFields key={tracked.version} state={state} />
      <FormMessage state={state} />
      <OneTimePassword state={state} />
      <div>
        <SubmitButton pendingText="Creating…" pending={pending}>
          Create user
        </SubmitButton>
      </div>
    </form>
  );
}

function CreateUserFields({ state }: { state: ActionState }) {
  const [mode, setMode] = useState<"generate" | "typed">("generate");
  return (
    <>
      <div>
        <label htmlFor="nu-username" className="label">
          Username
        </label>
        <input
          id="nu-username"
          name="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          minLength={3}
          maxLength={32}
          className={fieldClass(state, "username")}
        />
        <p className="hint">{USERNAME_HINT}</p>
        <FieldError state={state} name="username" />
      </div>
      <div>
        <label htmlFor="nu-name" className="label">
          Display name
        </label>
        <input id="nu-name" name="name" required maxLength={100} className={fieldClass(state, "name")} />
        <FieldError state={state} name="name" />
      </div>
      <div>
        <label htmlFor="nu-email" className="label">
          Email <span className="font-normal text-muted">(optional)</span>
        </label>
        <input id="nu-email" name="email" type="email" className={fieldClass(state, "email")} />
        <FieldError state={state} name="email" />
      </div>
      <div>
        <label htmlFor="nu-role" className="label">
          Role
        </label>
        <select id="nu-role" name="role" defaultValue="USER" className="input">
          <option value="USER">User: their own journal only</option>
          <option value="ADMIN">Admin: also manages accounts</option>
        </select>
      </div>
      <fieldset>
        <legend className="label">Temporary password</legend>
        <div className="flex flex-col gap-1.5 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" value="generate" checked={mode === "generate"} onChange={() => setMode("generate")} />
            Generate one for me
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" value="typed" checked={mode === "typed"} onChange={() => setMode("typed")} />
            Type one now
          </label>
        </div>
        {mode === "typed" ? (
          <div className="mt-2">
            <label htmlFor="nu-password" className="sr-only">
              Temporary password
            </label>
            <input
              id="nu-password"
              name="password"
              type="text"
              autoComplete="off"
              minLength={10}
              maxLength={200}
              required
              placeholder="At least 10 characters"
              className={fieldClass(state, "password")}
            />
            <FieldError state={state} name="password" />
          </div>
        ) : null}
      </fieldset>
    </>
  );
}

function ResetPasswordForm({ user }: { user: AdminUserDTO }) {
  const { state, onSubmit, pending } = useActionForm(resetPasswordAction);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="userId" value={user.id} />
        {open ? (
          <div className="min-w-0 flex-1">
            <label htmlFor={`rp-${user.id}`} className="label">
              Temporary password <span className="font-normal text-muted">(leave empty to generate)</span>
            </label>
            <input id={`rp-${user.id}`} name="password" type="text" autoComplete="off" minLength={10} maxLength={200} className={fieldClass(state, "password")} />
            <FieldError state={state} name="password" />
          </div>
        ) : null}
        {open ? (
          <SubmitButton className="btn btn-sm" pendingText="Resetting…" pending={pending}>
            Reset password
          </SubmitButton>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
            Reset password
          </button>
        )}
        {open ? (
          <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
            Cancel
          </button>
        ) : null}
      </form>
      <FormMessage state={state} />
      <OneTimePassword state={state} />
    </div>
  );
}

function SimpleAction({
  action,
  fields,
  label,
  pendingText,
  confirm,
  className = "btn btn-sm",
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  label: string;
  pendingText: string;
  confirm?: string;
  className?: string;
}) {
  const { state, onSubmit, pending } = useActionForm(action);
  return (
    <form onSubmit={onSubmit} className="contents">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {confirm ? (
        <ConfirmSubmit message={confirm} className={className}>
          {pending ? pendingText : label}
        </ConfirmSubmit>
      ) : (
        <SubmitButton className={className} pendingText={pendingText} pending={pending}>
          {label}
        </SubmitButton>
      )}
      {state && !state.ok ? (
        <p role="alert" className="basis-full text-xs text-loss">
          {state.error}
        </p>
      ) : state?.ok && state.message ? (
        <p role="status" className="basis-full text-xs text-profit">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function UserCard({ user, isSelf }: { user: AdminUserDTO; isSelf: boolean }) {
  return (
    <li className="card card-pad flex min-w-0 flex-col gap-3" aria-label={`@${user.username}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {user.name} {isSelf ? <span className="text-xs font-normal text-muted">(you)</span> : null}
          </p>
          <p className="num truncate text-sm text-ink-2">@{user.username}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <span className={`chip ${user.role === "ADMIN" ? "border-signature/50 text-signature" : ""}`}>{user.role === "ADMIN" ? "Admin" : "User"}</span>
          <span className={`chip ${user.isActive ? "" : "border-loss-mark/50 text-loss"}`}>{user.isActive ? "Active" : "Inactive"}</span>
          {user.mustChangePassword ? <span className="chip">Temporary password</span> : null}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted sm:grid-cols-4">
        <div className="min-w-0">
          <dt>Last sign-in</dt>
          <dd className="truncate text-ink-2">{user.lastLogin ?? "Never"}</dd>
        </div>
        <div className="min-w-0">
          <dt>Created</dt>
          <dd className="truncate text-ink-2">{user.created}</dd>
        </div>
        <div className="min-w-0">
          <dt>Trades</dt>
          <dd className="num text-ink-2">{user.tradeCount}</dd>
        </div>
        <div className="min-w-0">
          <dt>Email</dt>
          <dd className="truncate text-ink-2">{user.email ?? "—"}</dd>
        </div>
      </dl>
      {isSelf ? (
        <p className="text-xs text-muted">Your own password and profile live in Settings. Another admin can change this account.</p>
      ) : (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <ResetPasswordForm user={user} />
          <div className="flex flex-wrap items-center gap-2">
            <SimpleAction
              action={setActiveAction}
              fields={{ userId: user.id, active: user.isActive ? "0" : "1" }}
              label={user.isActive ? "Deactivate" : "Reactivate"}
              pendingText="Saving…"
              confirm={user.isActive ? `Deactivate @${user.username}? They are signed out everywhere and cannot sign in until reactivated.` : undefined}
            />
            <SimpleAction
              action={setRoleAction}
              fields={{ userId: user.id, role: user.role === "ADMIN" ? "USER" : "ADMIN" }}
              label={user.role === "ADMIN" ? "Make user" : "Make admin"}
              pendingText="Saving…"
            />
            <SimpleAction
              action={deleteUserAction}
              fields={{ userId: user.id }}
              label="Delete"
              pendingText="Deleting…"
              className="btn btn-sm btn-danger"
              confirm={`Delete @${user.username} for good? Their trades, days, rules, tags, screenshots and links are removed. This cannot be undone.`}
            />
          </div>
        </div>
      )}
    </li>
  );
}

export function UserList({ users, currentUserId }: { users: AdminUserDTO[]; currentUserId: string }) {
  return (
    <ul className="flex flex-col gap-3">
      {users.map((u) => (
        <UserCard key={u.id} user={u} isSelf={u.id === currentUserId} />
      ))}
    </ul>
  );
}
