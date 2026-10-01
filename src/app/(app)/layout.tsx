import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Sidebar } from "@/components/Sidebar";
import { RestoreProvider } from "@/components/RestoreManager";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Server-side gate (defense in depth beyond middleware): verifies the session
  // against the DB, so a revoked/deleted session can't reach the app shell.
  const user = currentUser();
  if (!user) redirect("/login");

  return (
    // On desktop the shell is a fixed-height viewport: the sidebar stays put
    // and only <main> scrolls. On mobile it flows normally (sidebar is a drawer).
    <div className="flex min-h-screen lg:h-screen lg:overflow-hidden">
      <Sidebar
        username={user.username}
        isAdmin={user.isAdmin}
        canManageUsers={user.permissions.manageUsers}
        canEditConnections={user.permissions.editConnections}
      />
      <main className="flex-1 min-w-0 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
        {/* RestoreProvider lives here (not inside a page) so a running restore's
            dock survives navigation between pages. */}
        <RestoreProvider>
          <div className="w-full">{children}</div>
        </RestoreProvider>
      </main>
    </div>
  );
}
