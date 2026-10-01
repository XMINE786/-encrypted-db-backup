"use client";

import { useEffect, useState } from "react";

// Shown when the page isn't a secure context, so Web Crypto is unavailable and
// key generation / login can't run. Explains the HTTPS requirement.
export function InsecureContextNotice() {
  const [host, setHost] = useState("");
  useEffect(() => {
    setHost(window.location.host);
  }, []);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        <p className="font-medium">This page isn&apos;t a secure context.</p>
        <p className="mt-1 text-amber-200/80">
          Browsers only expose the Web Crypto API over <b>HTTPS</b> or on{" "}
          <code className="text-xs">localhost</code>. You opened DevGems at{" "}
          <code className="text-xs">{host || "an http:// address"}</code>, so key generation and
          key-based sign-in are disabled here.
        </p>
      </div>
      <div className="rounded-xl border border-white/5 bg-base-900/60 px-4 py-3 text-xs text-slate-400">
        <p className="mb-1 font-medium text-slate-300">To use it from another device:</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>Serve DevGems over <b>HTTPS</b> (e.g. behind a reverse proxy), or</li>
          <li>Open it on the host machine at <code>http://localhost:3000</code>.</li>
        </ul>
      </div>
    </div>
  );
}
