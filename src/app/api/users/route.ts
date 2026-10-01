import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  listUsers,
  getUserByUsername,
  isValidPublicKey,
  createUserWithKey,
} from "@/lib/auth";
import { normalizePerms } from "@/lib/permissions";
import { userDTO } from "@/lib/user-dto";

export const runtime = "nodejs";

export async function GET() {
  const guard = requirePermission("manageUsers");
  if ("error" in guard) return guard.error;
  return NextResponse.json(listUsers().map(userDTO));
}

export async function POST(req: NextRequest) {
  const guard = requirePermission("manageUsers");
  if ("error" in guard) return guard.error;

  const { username, publicKey, keyId, isAdmin, permissions } = await req.json();
  if (!username || String(username).trim().length < 3) {
    return NextResponse.json({ error: "Username must be at least 3 characters" }, { status: 400 });
  }
  if (getUserByUsername(String(username).trim())) {
    return NextResponse.json({ error: "That username is already taken" }, { status: 409 });
  }
  if (!publicKey || !isValidPublicKey(publicKey)) {
    return NextResponse.json({ error: "A valid ECDSA P-256 public key is required" }, { status: 400 });
  }

  const user = createUserWithKey({
    username: String(username).trim(),
    publicKey,
    keyId: keyId || "",
    isAdmin: !!isAdmin,
    permissions: normalizePerms(permissions),
  });
  return NextResponse.json(userDTO(user), { status: 201 });
}
