import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import zlib from "zlib";
import path from "path";
import { Readable } from "stream";
import { db, BACKUP_DIR, BackupRow } from "@/lib/db";
import { createDecryptStream } from "@/lib/crypto";
import { ENGINES, EngineId } from "@/lib/engines";
import { requirePermission } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requirePermission("viewBackups");
  if ("error" in guard) return guard.error;
  const row = db()
    .prepare(
      `SELECT b.*, c.engine AS engine FROM backups b
       JOIN connections c ON c.id=b.connection_id WHERE b.id=?`
    )
    .get(Number(params.id)) as (BackupRow & { engine: string }) | undefined;

  if (!row || row.status !== "success" || !row.filename || !row.iv || !row.auth_tag) {
    return NextResponse.json({ error: "Backup not available" }, { status: 404 });
  }

  const filePath = path.join(BACKUP_DIR, row.filename);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Backup file missing on disk" }, { status: 410 });
  }

  // Query param ?decrypt=1 returns the plaintext dump; otherwise the .enc blob.
  const decrypt = req.nextUrl.searchParams.get("decrypt") === "1";
  const ext = ENGINES[row.engine as EngineId]?.ext ?? "dump";
  const outName = decrypt
    ? row.filename.replace(/\.enc$/, "")
    : row.filename;

  // decrypt=1 yields the true plaintext dump, so gunzip too when the payload
  // was compressed. The raw (?decrypt=0) download is the opaque .enc blob.
  const fileStream = fs.createReadStream(filePath);
  let nodeStream: Readable = fileStream;
  if (decrypt) {
    nodeStream = fileStream.pipe(createDecryptStream(row.iv, row.auth_tag));
    if (row.compressed) nodeStream = nodeStream.pipe(zlib.createGunzip());
  }

  // Bridge Node stream -> Web ReadableStream for the Next.js Response.
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${outName}"`,
    },
  });
}
