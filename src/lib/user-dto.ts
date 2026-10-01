import { UserRow } from "./db";
import { effectivePerms } from "./permissions";

// Public shape of a user for the management UI. Never exposes anything secret
// (the public key is safe; there is no private key on the server).
export function userDTO(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    isAdmin: !!u.is_admin,
    permissions: effectivePerms(!!u.is_admin, u.permissions),
    fingerprint: u.fingerprint,
    hasKey: !!u.public_key,
    created_at: u.created_at,
    last_login_at: u.last_login_at,
  };
}
