#!/usr/bin/env node
// DevGems self-service key generator (ECDSA P-256).
//
// Usage:   node scripts/generate-key.mjs <username>
//
// Produces:
//   • devgems-<username>.key.json  -> keep this; use it to sign in
//   • prints the PUBLIC key (SPKI base64) -> send this to your admin
//
// No dependencies — uses Node's built-in crypto. Node 16+.

import crypto from "crypto";
import fs from "fs";

const username = process.argv[2];
if (!username || username.length < 3) {
  console.error("Usage: node scripts/generate-key.mjs <username>   (min 3 chars)");
  process.exit(1);
}

// Generate an ECDSA P-256 key pair.
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
  namedCurve: "P-256",
});

// Public key in the exact format DevGems expects (SPKI DER, base64, one line).
const publicKeySpki = publicKey.export({ type: "spki", format: "der" }).toString("base64");

// Private key as a JWK — the login file embeds this so the browser can sign.
const privateJwk = privateKey.export({ format: "jwk" });

const keyFile = {
  app: "DevGems",
  type: "devgems-private-key",
  username,
  keyId: crypto.randomUUID(),
  alg: "ES256",
  createdAt: new Date().toISOString(),
  privateKey: privateJwk,
  publicKeySpki,
};

const filename = `devgems-${username}.key.json`;
fs.writeFileSync(filename, JSON.stringify(keyFile, null, 2));

console.log(`\n✅ Wrote ${filename}  (KEEP THIS — it's how you sign in; never share it)\n`);
console.log("📮 Send this PUBLIC key to your admin (paste into 'New user → Paste public key'):\n");
console.log(publicKeySpki + "\n");
