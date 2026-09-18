import Link from "next/link";
import { logoutAction } from "@/actions/auth";
import { LogoMark } from "@/components/icons";
import { BottomNav, LogoutButton, SidebarNav } from "@/components/nav";
import type { CurrentUser } from "@/lib/auth";

export function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface md:flex md:flex-col">
        <div className="flex items-center gap-2 px-5 py-5">
          <LogoMark />
          <span className="text-base font-semibold tracking-tight">Darkpools</span>
        </div>
        <div className="flex flex-1 flex-col px-3 pb-4">
          <SidebarNav logout={<LogoutButton action={logoutAction} />} />
        </div>
        <div className="border-t border-line px-5 py-3 text-xs text-muted">
          <p className="truncate text-ink-2">{user.name}</p>
          <p className="truncate">{user.email}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur md:hidden">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <LogoMark /> Darkpools
          </Link>
          <span className="truncate text-xs text-muted">{user.name}</span>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-4 sm:px-6 md:pb-10 md:pt-6">{children}</main>
      </div>

      <BottomNav logout={<LogoutButton action={logoutAction} compact />} />
    </div>
  );
}
