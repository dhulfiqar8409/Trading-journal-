import { logoutAction } from "@/actions/auth";
import { PasswordForm, ProfileForm } from "@/components/settings-forms";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const tradeCount = await db.trade.count({ where: { userId: user.id } });
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">Signed in as {user.email}.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card card-pad">
          <h2 className="mb-3 text-sm font-semibold">Profile</h2>
          <ProfileForm name={user.name} timeZone={user.timeZone} />
        </section>
        <section className="card card-pad">
          <h2 className="mb-3 text-sm font-semibold">Password</h2>
          <PasswordForm />
        </section>
        <section className="card card-pad">
          <h2 className="mb-1 text-sm font-semibold">Export</h2>
          <p className="mb-3 text-sm text-muted">
            Download all {tradeCount} trade{tradeCount === 1 ? "" : "s"} as CSV, including tags and notes. Screenshots are not included.
          </p>
          <a href="/api/export/trades" className="btn" download>
            Export trades as CSV
          </a>
        </section>
        <section className="card card-pad">
          <h2 className="mb-1 text-sm font-semibold">Session</h2>
          <p className="mb-3 text-sm text-muted">Sessions last 30 days on this device.</p>
          <form action={logoutAction}>
            <button type="submit" className="btn">
              Log out
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
