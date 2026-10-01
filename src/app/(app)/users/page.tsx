import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { UsersClient } from "./UsersClient";

export const dynamic = "force-dynamic";

export default function UsersPage() {
  const user = currentUser();
  if (!user) redirect("/login");
  if (!user.permissions.manageUsers) redirect("/");

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Users</h1>
        <p className="mt-1 text-sm text-slate-500">
          Key-based accounts and their permissions. Private keys never touch the server.
        </p>
      </div>
      <UsersClient currentUserId={user.id} />
    </div>
  );
}
