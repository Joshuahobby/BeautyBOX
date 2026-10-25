import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { serverEnv } from "./env";

/** Bearer secrets (guest sessions, private order links): 32 random bytes, base64url. */
export function newOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Keyed hash for bearer tokens. Only the hash is stored, so a database leak alone
 * does not reveal usable tokens, and the key prevents offline guessing.
 */
export function hashToken(token: string): string {
  return createHmac("sha256", serverEnv().TOKEN_HASH_SECRET).update(token, "utf8").digest("base64url");
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Stable JSON (sorted keys) so equivalent request bodies hash identically. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

// AES-256-GCM for restricted personal data at rest (payer phone, callback evidence).
const VERSION = "v1";

function key(): Buffer {
  return Buffer.from(serverEnv().DATA_ENCRYPTION_KEY, "base64");
}

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(".");
}

export function decryptField(sealed: string): string {
  const [version, iv, ciphertext, tag] = sealed.split(".");
  if (version !== VERSION || !iv || !ciphertext || !tag) throw new Error("Unsupported encrypted field format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
