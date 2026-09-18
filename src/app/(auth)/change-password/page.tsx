import Link from "next/link";
import { logoutAction } from "@/actions/auth";
import { LogoutButton } from "@/components/nav";
import { requireUser } from "@/lib/auth";
import { ChangePasswordForm } from "./change-password-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Choose a password" };

/**
 * Where a session that signed in with a temporary password lands before
 * anything else. Also usable at any time by a signed-in user.
 */
export default async function ChangePasswordPage() {
  const user = await requireUser({ allowPasswordChange: true });
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Choose a new password</h1>
      <p className="mb-5 text-sm text-muted">
        {user.mustChangePassword
          ? `Hi ${user.name}. You signed in with a temporary password; pick your own before opening the journal.`
          : `Signed in as @${user.username}. Other devices are signed out when the password changes.`}
      </p>
      <ChangePasswordForm forced={user.mustChangePassword} />
      <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-sm">
        {user.mustChangePassword ? (
          <span className="text-muted">Not you?</span>
        ) : (
          <Link href="/settings" className="text-accent underline">
            Back to settings
          </Link>
        )}
        <LogoutButton action={logoutAction} compact />
      </div>
    </>
  );
}
