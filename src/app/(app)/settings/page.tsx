import Link from "next/link";
import { logoutAction } from "@/actions/auth";
import { revokeShareLinkAction } from "@/actions/share";
import { PasswordForm, ProfileForm } from "@/components/settings-forms";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const [tradeCount, shareLinks, presets] = await Promise.all([
    db.trade.count({ where: { userId: user.id } }),
    db.shareLink.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: {} }),
    db.importPreset.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
  ]);
  const activeLinks = shareLinks.filter((l) => !l.revokedAt);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="mt-1 text-sm text-muted">Signed in as {user.email}.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card card-pad">
          <h2 className="mb-3 text-sm font-semibold">Profile</h2>
          <ProfileForm name={user.name} timeZone={user.timeZone} displayMode={user.displayMode} />
        </section>
        <section className="card card-pad">
          <h2 className="mb-3 text-sm font-semibold">Password</h2>
          <PasswordForm />
        </section>
        <section className="card card-pad" aria-label="Export">
          <h2 className="mb-1 text-sm font-semibold">Export</h2>
          <p className="mb-3 text-sm text-muted">
            Everything you logged, nothing gated. {tradeCount} trade{tradeCount === 1 ? "" : "s"} so far. Screenshots stay in the uploads folder and are referenced by
            file name.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href="/api/export/all" className="btn btn-primary" download>
              Everything as JSON
            </a>
            <a href="/api/export/trades" className="btn" download>
              Trades CSV
            </a>
            <a href="/api/export/days" className="btn" download>
              Days CSV
            </a>
            <a href="/api/export/rules" className="btn" download>
              Rules CSV
            </a>
            <a href="/api/export/tags" className="btn" download>
              Tags CSV
            </a>
          </div>
        </section>
        <section className="card card-pad" aria-label="Share links">
          <h2 className="mb-1 text-sm font-semibold">Share links</h2>
          <p className="mb-3 text-sm text-muted">Read-only links to a trade or a week. Revoking one stops it immediately.</p>
          {activeLinks.length === 0 ? (
            <p className="text-sm text-muted">No active links.</p>
          ) : (
            <ul className="divide-y divide-line">
              {activeLinks.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <Link href={`/share/${l.token}`} className="font-medium hover:text-accent-strong">
                      {l.kind === "WEEK" ? `Week ${l.targetId}` : "Trade"}
                    </Link>
                    <p className="text-xs text-muted">
                      {formatDateTime(l.createdAt, user.timeZone)} · {l.hideDollars ? "dollars hidden" : "dollars shown"}
                    </p>
                  </div>
                  <form action={revokeShareLinkAction.bind(null, l.id, "/settings")}>
                    <button type="submit" className="btn btn-sm btn-danger">
                      Revoke
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card card-pad" aria-label="Import presets">
          <h2 className="mb-1 text-sm font-semibold">Saved import mappings</h2>
          <p className="mb-3 text-sm text-muted">Column mappings saved from the import page, one per broker export format.</p>
          {presets.length === 0 ? (
            <p className="text-sm text-muted">
              None yet. Save one from{" "}
              <Link href="/import" className="text-accent underline">
                Import
              </Link>
              .
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <li key={p.id} className="badge">
                  {p.name}
                </li>
              ))}
            </ul>
          )}
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
