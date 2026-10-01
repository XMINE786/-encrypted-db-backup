import crypto from "crypto";
import { Transform } from "stream";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM standard
const SALT = "devgems.v1.salt"; // static app salt for key derivation

let cachedKey: Buffer | null = null;

/** Derive a 32-byte AES key from the master passphrase via scrypt. */
export function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.BACKUP_ENCRYPTION_KEY;
  if (!secret || secret.length < 8) {
    throw new Error(
      "BACKUP_ENCRYPTION_KEY is not set (or too short). Set it in your environment before running."
    );
  }
  cachedKey = crypto.scryptSync(secret, SALT, 32);
  return cachedKey;
}

/** Encrypt a short string (e.g. a DB password). Returns iv:tag:cipher hex. */
export function encryptString(plain: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

/** Reverse of encryptString. */
export function decryptString(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Malformed encrypted value");
  const decipher = crypto.createDecipheriv(ALGO, masterKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

export interface StreamCipher {
  iv: string;
  stream: crypto.CipherGCM;
  /** Auth tag — only valid AFTER the stream has fully flushed. */
  getTag(): string;
}

/** Create a GCM cipher stream for encrypting a large backup payload. */
export function createEncryptStream(): StreamCipher {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, masterKey(), iv) as crypto.CipherGCM;
  return {
    iv: iv.toString("hex"),
    stream: cipher,
    getTag: () => cipher.getAuthTag().toString("hex"),
  };
}

/** Create a GCM decipher transform for streaming a backup back out. */
export function createDecryptStream(ivHex: string, tagHex: string): Transform {
  const decipher = crypto.createDecipheriv(
    ALGO,
    masterKey(),
    Buffer.from(ivHex, "hex")
  ) as crypto.DecipherGCM;
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher;
}

/** Quick fingerprint of the active key, so the UI can warn on key changes. */
export function keyFingerprint(): string {
  return crypto.createHash("sha256").update(masterKey()).digest("hex").slice(0, 12);
}
