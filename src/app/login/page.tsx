"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { Spinner } from "@/components/ui";
import { KeyGenerator } from "@/components/KeyGenerator";
import { InsecureContextNotice } from "@/components/InsecureContextNotice";
import { parseKeyFile, signNonce, isCryptoAvailable, KeyFile } from "@/lib/webcrypto";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") || "/";
  const fileRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<"login" | "generate">("login");
  const [keyFile, setKeyFile] = useState<KeyFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [secure, setSecure] = useState(true);

  useEffect(() => {
    setSecure(isCryptoAvailable());
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.needsSetup) router.replace("/setup");
        else if (d.user) router.replace(from);
        else setReady(true);
      })
      .catch(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setKeyFile(await parseKeyFile(file));
    } catch (err: any) {
      setKeyFile(null);
      setError(err.message);
    }
  }

  async function signIn() {
    if (!keyFile) return;
    setBusy(true);
    setError(null);
    try {
      // 1) Ask the server for a challenge.
      const chRes = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: keyFile.username }),
      });
      const ch = await chRes.json();
      if (!chRes.ok) throw new Error(ch.error || "Could not start login");
      // 2) Sign the nonce locally with the private key.
      const signature = await signNonce(keyFile.privateKey, ch.nonce);
      // 3) Send the signature for verification.
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: ch.challengeId, signature }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Login failed");
      router.replace(from);
      router.refresh();
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

  if (mode === "generate") {
    return (
      <AuthShell
        title="Generate a key pair"
        subtitle="Create your keys on this device, then send the public key to your administrator."
        badge="New user"
      >
        <KeyGenerator />
        <button
          type="button"
          onClick={() => setMode("login")}
          className="mt-5 w-full text-center text-xs text-slate-500 hover:text-slate-300"
        >
          ← Back to sign in
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign in with your key" subtitle="Select your DevGems key file to authenticate.">
      <div className="space-y-4">
        <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFile} className="hidden" />

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/5 px-4 py-6 text-center transition hover:border-brand-400/50 hover:bg-white/10"
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-brand-300" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-sm font-medium text-slate-200">
            {keyFile ? "Choose a different key file" : "Select your key file"}
          </span>
          <span className="text-xs text-slate-500">devgems-*.key.json</span>
        </button>

        {keyFile && (
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-base-900/60 px-3.5 py-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-500/20 text-sm font-semibold uppercase text-brand-200">
              {keyFile.username.slice(0, 2)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-200">{keyFile.username}</div>
              <div className="text-xs text-slate-500">Key loaded · never sent to the server</div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">
            {error}
          </div>
        )}

        <button className="btn-primary w-full" onClick={signIn} disabled={busy || !keyFile}>
          {busy && <Spinner className="h-4 w-4" />}
          Sign in
        </button>

        <div className="border-t border-white/5 pt-4 text-center text-xs text-slate-500">
          Don&apos;t have an account yet?{" "}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setMode("generate");
            }}
            className="font-medium text-brand-300 hover:text-brand-200"
          >
            Generate your key pair
          </button>
        </div>
      </div>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
