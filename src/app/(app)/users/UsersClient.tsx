"use client";

import { useEffect, useState } from "react";
import { Spinner, EmptyState } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import {
  PERMISSIONS,
  PermissionKey,
  PermissionSet,
  DEFAULT_MEMBER_PERMS,
  normalizePerms,
} from "@/lib/permissions";
import {
  generateKeyMaterial,
  downloadKeyFile,
  isValidPublicKeyClient,
  randomKeyId,
} from "@/lib/webcrypto";

interface UserDTO {
  id: number;
  username: string;
  isAdmin: boolean;
  permissions: PermissionSet;
  fingerprint: string | null;
  hasKey: boolean;
  created_at: string;
  last_login_at: string | null;
}

export function UsersClient({ currentUserId }: { currentUserId: number }) {
  const [users, setUsers] = useState<UserDTO[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/users");
    setUsers(res.ok ? await res.json() : []);
  }
  useEffect(() => {
    load();
  }, []);

  if (users === null) {
    return (
      <div className="flex justify-center py-20 text-slate-500">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setCreating((v) => !v)}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          New user
        </button>
      </div>

      {flash && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {flash}
        </div>
      )}

      {creating && (
        <CreateUser
          onClose={() => setCreating(false)}
          onCreated={(msg) => {
            setCreating(false);
            setFlash(msg);
            load();
          }}
        />
      )}

      {users.length === 0 ? (
        <EmptyState title="No users yet" subtitle="Create the first team member." />
      ) : (
        <div className="grid gap-4">
          {users.map((u) => (
            <UserCard
              key={u.id}
              user={u}
              isSelf={u.id === currentUserId}
              expanded={editId === u.id}
              onToggle={() => setEditId(editId === u.id ? null : u.id)}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Create ----------
function CreateUser({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (msg: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [mode, setMode] = useState<"generate" | "paste">("generate");
  const [pubKey, setPubKey] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [perms, setPerms] = useState<PermissionSet>({ ...DEFAULT_MEMBER_PERMS });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(k: PermissionKey) {
    setPerms((p) => ({ ...p, [k]: !p[k] }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let publicKey = "";
      let keyId = "";
      if (mode === "generate") {
        const gen = await generateKeyMaterial(username.trim());
        publicKey = gen.publicKey;
        keyId = gen.keyId;
        // Admin downloads the private key to hand to the new user.
        downloadKeyFile(gen.keyFile);
      } else {
        publicKey = pubKey.trim();
        if (!(await isValidPublicKeyClient(publicKey))) {
          throw new Error("That isn't a valid ECDSA P-256 public key (SPKI base64).");
        }
        keyId = randomKeyId();
      }
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          publicKey,
          keyId,
          isAdmin,
          permissions: isAdmin ? undefined : normalizePerms(perms),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to create user");
      onCreated(
        mode === "generate"
          ? `Created "${username.trim()}". Their key file was downloaded — send it to them securely.`
          : `Created "${username.trim()}".`
      );
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card animate-fade-in space-y-5 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300">New user</h2>
        <button type="button" className="text-xs text-slate-500 hover:text-slate-300" onClick={onClose}>
          Cancel
        </button>
      </div>

      <div>
        <label className="label">Username</label>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} />
      </div>

      <div>
        <label className="label">Key</label>
        <div className="mb-3 flex gap-2">
          <ModeTab active={mode === "generate"} onClick={() => setMode("generate")} label="Generate for them" />
          <ModeTab active={mode === "paste"} onClick={() => setMode("paste")} label="Paste public key" />
        </div>
        {mode === "generate" ? (
          <p className="rounded-lg border border-white/5 bg-base-900/60 px-3 py-2 text-xs text-slate-500">
            A key pair is generated in your browser. The <b className="text-slate-300">private key file downloads to you</b> — hand it to the user over a secure channel. The server keeps only the public key.
          </p>
        ) : (
          <textarea
            className="input font-mono text-xs"
            rows={4}
            placeholder="Base64 SPKI public key the user generated"
            value={pubKey}
            onChange={(e) => setPubKey(e.target.value)}
            required
          />
        )}
      </div>

      <label className="flex items-center gap-3 rounded-xl border border-white/5 bg-base-900/40 px-3.5 py-3">
        <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} className="h-4 w-4 accent-brand-500" />
        <span>
          <span className="text-sm font-medium text-slate-200">Administrator</span>
          <span className="block text-xs text-slate-500">Full access to everything, including managing users.</span>
        </span>
      </label>

      {!isAdmin && <PermissionGrid perms={perms} onToggle={toggle} />}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">{error}</div>
      )}

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy && <Spinner className="h-4 w-4" />}
        Create user
      </button>
    </form>
  );
}

function ModeTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
        active ? "bg-brand-500/20 text-brand-200 ring-1 ring-brand-500/40" : "bg-white/5 text-slate-400 hover:bg-white/10"
      }`}
    >
      {label}
    </button>
  );
}

function PermissionGrid({ perms, onToggle }: { perms: PermissionSet; onToggle: (k: PermissionKey) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {PERMISSIONS.map((p) => (
        <label
          key={p.key}
          className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/5 bg-base-900/40 px-3 py-2.5"
        >
          <input
            type="checkbox"
            checked={perms[p.key]}
            onChange={() => onToggle(p.key)}
            className="mt-0.5 h-4 w-4 accent-brand-500"
          />
          <span>
            <span className="text-sm text-slate-200">{p.label}</span>
            <span className="block text-xs text-slate-500">{p.description}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

// ---------- Row + Edit ----------
function UserCard({
  user,
  isSelf,
  expanded,
  onToggle,
  onChanged,
}: {
  user: UserDTO;
  isSelf: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [perms, setPerms] = useState<PermissionSet>(user.permissions);
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activePerms = PERMISSIONS.filter((p) => user.permissions[p.key]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAdmin, permissions: normalizePerms(perms) }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to save");
      onChanged();
      onToggle();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete user "${user.username}"? Their key access is revoked immediately.`)) return;
    const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
    if (!res.ok) {
      alert((await res.json()).error || "Failed to delete");
      return;
    }
    onChanged();
  }

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500/20 text-sm font-semibold uppercase text-brand-200">
            {user.username.slice(0, 2)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white">{user.username}</span>
              {user.isAdmin && (
                <span className="badge bg-accent-500/15 text-accent-400 ring-1 ring-accent-500/30">admin</span>
              )}
              {isSelf && <span className="text-xs text-slate-500">(you)</span>}
            </div>
            <div className="text-xs text-slate-500">
              {user.last_login_at ? `Last login ${timeAgo(user.last_login_at)}` : "Never signed in"}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost !py-1.5 !px-3 text-xs" onClick={onToggle}>
            {expanded ? "Close" : "Edit"}
          </button>
          {!isSelf && (
            <button className="btn-danger !py-1.5 !px-3 text-xs" onClick={remove}>
              Delete
            </button>
          )}
        </div>
      </div>

      {!expanded && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {user.isAdmin ? (
            <span className="badge bg-white/5 text-slate-400">Full access</span>
          ) : activePerms.length ? (
            activePerms.map((p) => (
              <span key={p.key} className="badge bg-white/5 text-slate-400">
                {p.label}
              </span>
            ))
          ) : (
            <span className="badge bg-white/5 text-slate-500">No permissions</span>
          )}
        </div>
      )}

      {expanded && (
        <div className="mt-4 space-y-4 border-t border-white/5 pt-4">
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} className="h-4 w-4 accent-brand-500" />
            <span className="text-sm text-slate-200">Administrator (full access)</span>
          </label>
          {!isAdmin && (
            <PermissionGrid perms={perms} onToggle={(k) => setPerms((p) => ({ ...p, [k]: !p[k] }))} />
          )}
          {user.fingerprint && (
            <p className="font-mono text-[11px] text-slate-500">key {user.fingerprint}</p>
          )}
          {error && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
          <div className="flex gap-2">
            <button className="btn-primary !py-1.5 !px-3 text-xs" onClick={save} disabled={busy}>
              {busy && <Spinner className="h-3.5 w-3.5" />}
              Save changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
