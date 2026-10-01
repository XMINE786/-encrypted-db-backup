import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db, ConnectionRow } from "@/lib/db";
import { toConnectionDTO } from "@/lib/serialize";
import { currentUser } from "@/lib/auth";
import { ConnectionForm } from "@/components/ConnectionForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function EditConnectionPage({ params }: { params: { id: string } }) {
  if (!currentUser()?.permissions.editConnections) redirect("/connections");
  const row = db()
    .prepare(`SELECT * FROM connections WHERE id=?`)
    .get(Number(params.id)) as ConnectionRow | undefined;
  if (!row) notFound();
  const c = toConnectionDTO(row);

  return (
    <div className="animate-fade-in">
      <nav className="mb-2 text-xs text-slate-500">
        <Link href="/connections" className="hover:text-slate-300">
          Connections
        </Link>{" "}
        / {c.name}
      </nav>
      <h1 className="mb-6 text-2xl font-semibold text-white">Edit backup source</h1>
      <ConnectionForm
        initial={{
          id: c.id,
          name: c.name,
          engine: c.engine,
          host: c.host,
          port: c.port ? String(c.port) : "",
          database: c.database,
          username: c.username,
          password: "",
          options: c.options ?? "",
          schema: c.schema ?? "",
          schedule: c.schedule ?? "",
          retention: String(c.retention),
          hasPassword: c.hasPassword,
        }}
      />
    </div>
  );
}
