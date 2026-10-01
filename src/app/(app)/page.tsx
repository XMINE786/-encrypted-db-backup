import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { DashboardClient } from "./DashboardClient";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const canEdit = !!currentUser()?.permissions.editConnections;
  return (
    <div className="animate-fade-in space-y-8">
      <div className="card relative overflow-hidden p-6 sm:p-8">
        <div className="relative z-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="badge mb-3 bg-accent-500/15 text-accent-400 ring-1 ring-accent-500/30">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-400" />
              Encrypted · Multi-engine
            </div>
            <h1 className="text-3xl font-semibold text-white">Backup control center</h1>
            <p className="mt-2 max-w-xl text-sm text-slate-400">
              Create, schedule, and restore AES-256 encrypted backups for PostgreSQL, MySQL, SQL
              Server, Oracle, MongoDB and SQLite — all from one dashboard.
            </p>
          </div>
          {canEdit && (
            <Link href="/connections/new" className="btn-primary shrink-0">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
              New backup source
            </Link>
          )}
        </div>
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-500/20 blur-3xl" />
      </div>

      <DashboardClient />
    </div>
  );
}
