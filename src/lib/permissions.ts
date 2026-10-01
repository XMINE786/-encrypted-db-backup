// Role/permission model. Admins implicitly have every permission and are the
// only ones who can manage users. Non-admin members get a subset of these.

export type PermissionKey =
  | "viewBackups"
  | "runBackups"
  | "editConnections"
  | "deleteBackups"
  | "manageUsers";

export interface PermissionMeta {
  key: PermissionKey;
  label: string;
  description: string;
}

export const PERMISSIONS: PermissionMeta[] = [
  { key: "viewBackups", label: "View backups", description: "See connections and backup history, and download backups." },
  { key: "runBackups", label: "Run backups", description: "Trigger backups on demand and test connections." },
  { key: "editConnections", label: "Edit connections", description: "Create and modify backup sources (incl. schedules)." },
  { key: "deleteBackups", label: "Delete", description: "Delete connections and individual backup files." },
  { key: "manageUsers", label: "Manage users", description: "View, create, edit, and delete other users." },
];

export type PermissionSet = Record<PermissionKey, boolean>;

export const ALL_PERMS: PermissionSet = {
  viewBackups: true,
  runBackups: true,
  editConnections: true,
  deleteBackups: true,
  manageUsers: true,
};

export const NO_PERMS: PermissionSet = {
  viewBackups: false,
  runBackups: false,
  editConnections: false,
  deleteBackups: false,
  manageUsers: false,
};

/** Sensible default for a newly-created member: read + run, no destructive ops. */
export const DEFAULT_MEMBER_PERMS: PermissionSet = {
  viewBackups: true,
  runBackups: true,
  editConnections: false,
  deleteBackups: false,
  manageUsers: false,
};

/** Normalize an arbitrary object into a complete PermissionSet. */
export function normalizePerms(input: unknown): PermissionSet {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    viewBackups: !!src.viewBackups,
    runBackups: !!src.runBackups,
    editConnections: !!src.editConnections,
    deleteBackups: !!src.deleteBackups,
    manageUsers: !!src.manageUsers,
  };
}

/** Effective permissions for a user — admins get everything. */
export function effectivePerms(isAdmin: boolean, permissionsJson: string): PermissionSet {
  if (isAdmin) return { ...ALL_PERMS };
  try {
    return normalizePerms(JSON.parse(permissionsJson || "{}"));
  } catch {
    return { ...NO_PERMS };
  }
}
