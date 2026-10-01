"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { Spinner } from "@/components/ui";
import { generateKeyMaterial, downloadKeyFile, KeyFile } from "@/lib/webcrypto";

export default function SetupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState<KeyFile | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (!d.needsSetup) router.replace("/login");
        else setReady(true);
      })
      .catch(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { publicKey, keyId, keyFile } = await generateKeyMaterial(username.trim());
      // Download the private key before registering, so it can't be lost.
      downloadKeyFile(keyFile);
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), publicKey, keyId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Setup failed");
      setDone(keyFile);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <div className="flex justify-center py-10 text-slate-500">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (done) {
    return (
      <AuthShell title="Admin account created" subtitle="Your private key was downloaded — keep it safe." badge="Setup complete">
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <p className="font-medium">Save your key file now.</p>
            <p className="mt-1 text-amber-200/80">
              <code className="text-xs">devgems-{done.username}.key.json</code> is your only way to
              sign in. It cannot be recovered if lost.
            </p>
          </div>
          <button className="btn-ghost w-full" onClick={() => downloadKeyFile(done)}>
            Download key again
          </button>
          <button className="btn-primary w-full" onClick={() => router.replace("/")}>
            Continue to dashboard
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your admin account"
      subtitle="First run. We'll generate a key pair — your private key downloads to this device and the server keeps only the public key."
      badge="First-time setup"
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Username</label>
          <input
            className="input"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            required
            minLength={3}
          />
        </div>
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">
            {error}
          </div>
        )}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy && <Spinner className="h-4 w-4" />}
          Generate key & create admin
        </button>
        <p className="text-center text-xs text-slate-500">
          A <code>.key.json</code> file will download. You'll need it to sign in.
        </p>
      </form>
    </AuthShell>
  );
}
