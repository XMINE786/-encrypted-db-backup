import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ConnectionForm } from "@/components/ConnectionForm";

export const dynamic = "force-dynamic";

export default function NewConnectionPage() {
  if (!currentUser()?.permissions.editConnections) redirect("/connections");
  return (
    <div className="animate-fade-in">
      <nav className="mb-2 text-xs text-slate-500">
        <Link href="/connections" className="hover:text-slate-300">
          Connections
        </Link>{" "}
        / New
      </nav>
      <h1 className="mb-6 text-2xl font-semibold text-white">New backup source</h1>
      <ConnectionForm />
    </div>
  );
}
