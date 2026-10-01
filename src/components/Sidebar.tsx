"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "./ThemeToggle";

const nav = [
  { href: "/", label: "Dashboard", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { href: "/connections", label: "Connections", icon: "M4 7h16M4 12h16M4 17h16" },
  { href: "/backups", label: "Backup History", icon: "M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
];

const usersNav = {
  href: "/users",
  label: "Users",
  icon: "M17 20v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M10 10a4 4 0 100-8 4 4 0 000 8M20 8v6M23 11h-6",
};

export function Sidebar({
  username,
  isAdmin,
  canManageUsers,
  canEditConnections,
}: {
  username?: string;
  isAdmin?: boolean;
  canManageUsers?: boolean;
  canEditConnections?: boolean;
}) {
  const pathname = usePathname();
  const items = canManageUsers ? [...nav, usersNav] : nav;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-white/5 bg-base-900/90 px-4 py-3 backdrop-blur lg:hidden">
        <Brand />
        <button
          className="btn-ghost !px-2.5 !py-2"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle navigation"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* Overlay for mobile */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed z-40 flex h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-white/5 bg-base-900/80 px-4 py-6 backdrop-blur transition-transform lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-2">
          <Brand />
        </div>

        <nav className="mt-8 flex flex-col gap-1">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                isActive(n.href)
                  ? "bg-brand-500/15 text-brand-100 shadow-[inset_0_0_0_1px_rgba(59,109,255,0.3)]"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d={n.icon} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {n.label}
            </Link>
          ))}
        </nav>

        {canEditConnections && (
          <Link href="/connections/new" onClick={() => setOpen(false)} className="btn-primary mt-6">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            New Backup Source
          </Link>
        )}

        <div className="mt-auto space-y-3">
          <ThemeToggle className="w-full justify-center" />

          <div className="rounded-xl border border-white/5 bg-base-850/60 p-3 text-xs text-slate-500">
            <div className="flex items-center gap-2 text-accent-400">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 2l7 4v6c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-4z" strokeLinejoin="round" />
              </svg>
              AES-256-GCM
            </div>
            <p className="mt-1 leading-relaxed">
              Credentials & backup files are encrypted at rest.
            </p>
          </div>

          {username && (
            <div className="flex items-center gap-2.5 rounded-xl border border-white/5 bg-base-850/60 p-2.5">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-500/20 text-sm font-semibold uppercase text-brand-200">
                {username.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-slate-200">{username}</div>
                <div className="text-[10px] text-slate-500">{isAdmin ? "Administrator" : "Signed in"}</div>
              </div>
              <button
                onClick={logout}
                disabled={loggingOut}
                title="Sign out"
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-red-300 disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Spacer so mobile content clears the fixed top bar */}
      <div className="h-14 lg:hidden" />
    </>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-accent-500 text-[#ffffff] shadow-glow">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2l7 4v6c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-4z" strokeLinejoin="round" />
          <path d="M9.5 12l1.8 1.8L15 10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div>
        <div className="text-sm font-semibold text-white">DevGems</div>
        <div className="text-[11px] text-slate-500">Encrypted DB Backups</div>
      </div>
    </div>
  );
}
