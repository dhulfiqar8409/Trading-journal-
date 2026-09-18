"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  CloseIcon,
  DashboardIcon,
  ListIcon,
  LogoutIcon,
  MoreIcon,
  PlusIcon,
  ReportIcon,
  RuleIcon,
  SettingsIcon,
  SunIcon,
  TagIcon,
  UploadIcon,
  UsersIcon,
  WalletIcon,
} from "@/components/icons";

interface NavItem {
  href: string;
  label: string;
  icon: (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element;
  exact?: boolean;
}

const PRIMARY: NavItem[] = [
  { href: "/today", label: "Today", icon: SunIcon },
  { href: "/", label: "Dashboard", icon: DashboardIcon, exact: true },
  { href: "/trades/new", label: "New trade", icon: PlusIcon, exact: true },
  { href: "/trades", label: "Trades", icon: ListIcon },
];

const SECONDARY: NavItem[] = [
  { href: "/reports", label: "Reports", icon: ReportIcon },
  { href: "/rules", label: "Rules", icon: RuleIcon },
  { href: "/import", label: "Import", icon: UploadIcon },
  { href: "/tags", label: "Tags", icon: TagIcon },
  { href: "/accounts", label: "Accounts", icon: WalletIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

const ADMIN: NavItem[] = [{ href: "/admin/users", label: "Users", icon: UsersIcon }];

function secondaryFor(isAdmin: boolean): NavItem[] {
  return isAdmin ? [...SECONDARY, ...ADMIN] : SECONDARY;
}

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  if (item.href === "/trades") return pathname.startsWith("/trades") && pathname !== "/trades/new";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function SidebarNav({ logout, isAdmin = false }: { logout: React.ReactNode; isAdmin?: boolean }) {
  const pathname = usePathname();
  const secondary = secondaryFor(isAdmin);
  const render = (item: NavItem) => {
    const active = isActive(pathname, item);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={`pressable flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          active ? "bg-signature-soft text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
        }`}
      >
        <item.icon className={active ? "text-signature" : "text-muted"} />
        {item.label}
      </Link>
    );
  };
  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-6">
      <div className="flex flex-col gap-1">{PRIMARY.map(render)}</div>
      <div className="flex flex-col gap-1">
        <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted">Manage</p>
        {secondary.map(render)}
      </div>
      <div className="mt-auto">{logout}</div>
    </nav>
  );
}

export function BottomNav({ logout, isAdmin = false }: { logout: React.ReactNode; isAdmin?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const secondary = secondaryFor(isAdmin);

  const moreActive = secondary.some((item) => isActive(pathname, item));
  const tab = (active: boolean) =>
    `pressable flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${active ? "text-signature" : "text-muted"}`;

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="More">
          <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">More</p>
              <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
                <CloseIcon width={16} height={16} /> Close
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {secondary.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-ink hover:bg-surface-2"
                >
                  <item.icon className="text-muted" /> {item.label}
                </Link>
              ))}
              <div className="mt-2 border-t border-line pt-2">{logout}</div>
            </div>
          </div>
        </div>
      ) : null}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {PRIMARY.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={tab(active)}>
              <item.icon />
              {item.label === "New trade" ? "New" : item.label}
            </Link>
          );
        })}
        <button type="button" className={tab(moreActive || open)} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <MoreIcon />
          More
        </button>
      </nav>
    </>
  );
}

export function LogoutButton({ action, compact = false }: { action: () => Promise<void>; compact?: boolean }) {
  return (
    <form action={action}>
      <button
        type="submit"
        className={
          compact
            ? "btn btn-sm"
            : "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
        }
      >
        <LogoutIcon className="text-muted" width={compact ? 16 : 20} height={compact ? 16 : 20} />
        Log out
      </button>
    </form>
  );
}
