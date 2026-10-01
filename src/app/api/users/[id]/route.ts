import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  getUserById,
  getUserByUsername,
  updateUser,
  deleteUser,
  countAdmins,
} from "@/lib/auth";
import { normalizePerms } from "@/lib/permissions";
import { userDTO } from "@/lib/user-dto";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requirePermission("manageUsers");
  if ("error" in guard) return guard.error;

  const id = Number(params.id);
  const target = getUserById(id);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const nextIsAdmin = body.isAdmin !== undefined ? !!body.isAdmin : !!target.is_admin;

  // Don't allow demoting the last remaining admin.
  if (!!target.is_admin && !nextIsAdmin && countAdmins() <= 1) {
    return NextResponse.json({ error: "Cannot demote the last admin" }, { status: 400 });
  }
  // Enforce unique username if it's being changed.
  if (body.username && String(body.username).trim() !== target.username) {
    if (getUserByUsername(String(body.username).trim())) {
      return NextResponse.json({ error: "That username is already taken" }, { status: 409 });
    }
  }

  updateUser(id, {
    username: body.username ? String(body.username).trim() : undefined,
    isAdmin: nextIsAdmin,
    permissions: body.permissions ? normalizePerms(body.permissions) : undefined,
  });
  return NextResponse.json(userDTO(getUserById(id)!));
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requirePermission("manageUsers");
  if ("error" in guard) return guard.error;

  const id = Number(params.id);
  const target = getUserById(id);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Never delete the last admin, and don't let an admin delete themselves.
  if (guard.user.id === id) {
    return NextResponse.json({ error: "You can't delete your own account" }, { status: 400 });
  }
  if (!!target.is_admin && countAdmins() <= 1) {
    return NextResponse.json({ error: "Cannot delete the last admin" }, { status: 400 });
  }

  deleteUser(id);
  return NextResponse.json({ ok: true });
}
