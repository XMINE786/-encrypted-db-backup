import { Suspense } from "react";
import { BackupsClient } from "./BackupsClient";

export const dynamic = "force-dynamic";

export default function BackupsPage() {
  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Backup history</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every backup is AES-256-GCM encrypted at rest. Download the raw <code>.enc</code> blob or
          a decrypted copy.
        </p>
      </div>
      <Suspense fallback={null}>
        <BackupsClient />
      </Suspense>
    </div>
  );
}
