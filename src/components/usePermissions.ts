"use client";

import { useEffect, useState } from "react";
import { PermissionSet, NO_PERMS } from "@/lib/permissions";

// Client hook: fetches the current user's effective permissions once.
export function usePermissions(): { perms: PermissionSet; isAdmin: boolean; loaded: boolean } {
  const [state, setState] = useState<{ perms: PermissionSet; isAdmin: boolean; loaded: boolean }>({
    perms: NO_PERMS,
    isAdmin: false,
    loaded: false,
  });

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.user) {
          setState({ perms: d.user.permissions, isAdmin: d.user.isAdmin, loaded: true });
        } else {
          setState({ perms: NO_PERMS, isAdmin: false, loaded: true });
        }
      })
      .catch(() => setState((s) => ({ ...s, loaded: true })));
  }, []);

  return state;
}
