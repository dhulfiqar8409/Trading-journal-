import { createShareLinkAction, revokeShareLinkAction } from "@/actions/share";
import { CopyField } from "@/components/copy-field";

export interface ShareLinkRow {
  id: string;
  token: string;
  hideDollars: boolean;
  createdAt: string;
}

/** Existing links for one target plus a form to mint another. Links are read-only and revocable. */
export function ShareLinks({ kind, targetId, returnTo, links, origin }: { kind: "TRADE" | "WEEK"; targetId: string; returnTo: string; links: ShareLinkRow[]; origin: string }) {
  return (
    <div className="flex flex-col gap-2">
      {links.length ? (
        <ul className="flex flex-col gap-2">
          {links.map((l) => (
            <li key={l.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
              <CopyField value={`${origin}/share/${l.token}`} />
              <span className="text-xs text-muted">{l.hideDollars ? "dollars hidden" : "dollars shown"}</span>
              <form action={revokeShareLinkAction.bind(null, l.id, returnTo)}>
                <button type="submit" className="btn btn-sm btn-danger">
                  Revoke
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">No share links yet. Anyone with a link can read this {kind === "TRADE" ? "trade" : "week"}; revoke it here or in Settings.</p>
      )}
      <form action={createShareLinkAction.bind(null, kind, targetId, returnTo)} className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-ink-2">
          <input type="checkbox" name="hideDollars" defaultChecked={kind === "WEEK"} /> Hide dollar amounts
        </label>
        <button type="submit" className="btn btn-sm">
          Create share link
        </button>
      </form>
    </div>
  );
}
