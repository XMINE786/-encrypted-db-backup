import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { ConnectionsClient } from "./ConnectionsClient";

export const dynamic = "force-dynamic";

export default function ConnectionsPage() {
  const canEdit = !!currentUser()?.permissions.editConnections;
  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Connections</h1>
          <p className="mt-1 text-sm text-slate-500">Databases configured for encrypted backup.</p>
        </div>
        {canEdit && (
          <Link href="/connections/new" className="btn-primary">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            New source
          </Link>
        )}
      </div>
      <ConnectionsClient />
    </div>
  );
}
