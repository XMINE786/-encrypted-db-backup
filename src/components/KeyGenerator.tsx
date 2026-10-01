"use client";

import { useEffect, useState } from "react";
import { Spinner } from "./ui";
import {
  generateKeyMaterial,
  downloadKeyFile,
  isCryptoAvailable,
  INSECURE_CONTEXT_MSG,
  KeyFile,
} from "@/lib/webcrypto";
import { InsecureContextNotice } from "./InsecureContextNotice";

// Self-service key generation. Runs entirely in the browser: the private key is
// downloaded to the user's device and never sent anywhere. The user copies the
// public key and hands it to an admin, who creates their account.
export function KeyGenerator() {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ publicKey: string; keyFile: KeyFile } | null>(null);
  const [copied, setCopied] = useState(false);
  const [secure, setSecure] = useState(true);

  useEffect(() => {
    setSecure(isCryptoAvailable());
  }, []);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { publicKey, keyFile } = await generateKeyMaterial(username.trim());
      downloadKeyFile(keyFile); // private key -> user's device
      setResult({ publicKey, keyFile });
    } catch (err: any) {
      setError(err.message || "Could not generate a key");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; the textarea is selectable as a fallback */
    }
  }

  if (!secure) {
    return <InsecureContextNotice />;
  }

  if (result) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <p className="font-medium">Your private key file was downloaded.</p>
          <p className="mt-1 text-amber-200/80">
            <code className="text-xs">devgems-{result.keyFile.username}.key.json</code> is how you'll
            sign in — keep it private, it can't be recovered.
          </p>
        </div>

        <div>
          <label className="label">Public key — send this to your administrator</label>
          <textarea
            readOnly
            rows={4}
            className="input font-mono text-xs"
            value={result.publicKey}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-ghost flex-1" onClick={copy}>
              {copied ? "Copied!" : "Copy public key"}
            </button>
            <button type="button" className="btn-ghost flex-1" onClick={() => downloadKeyFile(result.keyFile)}>
              Download key again
            </button>
          </div>
        </div>

        <p className="rounded-lg border border-white/5 bg-base-900/60 px-3 py-2 text-xs text-slate-500">
          Next: your admin pastes this public key to create your account. Then come back and sign in
          with your downloaded key file.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={generate} className="space-y-4">
      <div>
        <label className="label">Choose a username</label>
        <input
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="your-name"
          required
          minLength={3}
        />
        <p className="mt-1.5 text-xs text-slate-500">
          The key pair is generated on this device. Your private key downloads to you; only the public
          key is shared.
        </p>
      </div>
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">
          {error}
        </div>
      )}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy && <Spinner className="h-4 w-4" />}
        Generate my key pair
      </button>
    </form>
  );
}
