import "server-only";
import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

// HTTP Message Signatures (RFC 9421) and Content-Digest (RFC 9530) as pawaPay uses them
// (docs.pawapay.io/v2/docs/signatures, reviewed 2026-10-24; DR-042):
// - signature label "sig-pp"; covered components at least "@method" "@authority" "@path"
//   "signature-date" "content-digest" "content-type"; parameters alg, keyid, created, expires;
// - Content-Digest "sha-512=:<base64>:" (or sha-256) over the exact body bytes;
// - Signature-Date: a pawaPay-specific timestamp header, covered by the signature;
// - ECDSA signatures in pawaPay's examples and sample code are ASN.1 DER, not the raw r||s
//   RFC 9421 describes: requests are signed in DER, and callbacks are verified accepting both.

export const SIGNATURE_LABEL = "sig-pp";
export const REQUEST_COMPONENTS = ["@method", "@authority", "@path", "signature-date", "content-digest", "content-type"] as const;

export type SignatureAlgorithm = "ecdsa-p256-sha256" | "ecdsa-p384-sha384" | "rsa-pss-sha512" | "rsa-v1_5-sha256";

const HASH: Record<SignatureAlgorithm, string> = {
  "ecdsa-p256-sha256": "sha256",
  "ecdsa-p384-sha384": "sha384",
  "rsa-pss-sha512": "sha512",
  "rsa-v1_5-sha256": "sha256",
};

// ---------------------------------------------------------------- Content-Digest (RFC 9530)

export function contentDigest(body: Buffer | string, algorithm: "sha-512" | "sha-256" = "sha-512"): string {
  const hash = createHash(algorithm === "sha-512" ? "sha512" : "sha256").update(body).digest("base64");
  return `${algorithm}=:${hash}:`;
}

/** True when the header has a sha-256 or sha-512 entry and every such entry matches the body. */
export function contentDigestMatches(header: string | null, body: Buffer): boolean {
  if (!header) return false;
  const entries = splitTopLevel(header)
    .map((part) => /^\s*(sha-256|sha-512)=:([A-Za-z0-9+/=]+):\s*$/i.exec(part))
    .filter((m): m is RegExpExecArray => m !== null);
  if (entries.length === 0) return false;
  return entries.every((m) => {
    const algorithm = m[1]!.toLowerCase() === "sha-512" ? "sha512" : "sha256";
    const expected = createHash(algorithm).update(body).digest();
    const received = Buffer.from(m[2]!, "base64");
    return received.length === expected.length && received.equals(expected);
  });
}

// ---------------------------------------------------------------- Structured fields (RFC 8941, the subset used here)

/** Splits a structured-field dictionary on top-level commas (not inside quotes or parentheses). */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (quoted) {
      current += ch;
      if (ch === "\\" && i + 1 < value.length) current += value[++i];
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export type SignatureInput = {
  label: string;
  components: string[];
  params: Record<string, string | number>;
  /** The serialized inner list and parameters exactly as received, for "@signature-params". */
  raw: string;
};

export function parseSignatureInput(header: string | null): SignatureInput[] {
  if (!header) return [];
  const out: SignatureInput[] = [];
  for (const member of splitTopLevel(header)) {
    const m = /^\s*([a-z*][a-z0-9_.*-]*)=(\(([^)]*)\)((?:;[a-z*][a-z0-9_.*-]*=(?:"(?:[^"\\]|\\.)*"|-?\d+|[A-Za-z*][A-Za-z0-9:/_.*+-]*))*))\s*$/i.exec(member);
    if (!m) continue;
    const components = [...m[3]!.matchAll(/"((?:[^"\\]|\\.)*)"(;[^\s"]*)?/g)].map((c) => (c[2] ? `${c[1]}${c[2]}` : c[1]!));
    const params: Record<string, string | number> = {};
    for (const p of m[4]!.matchAll(/;([a-z*][a-z0-9_.*-]*)=("(?:[^"\\]|\\.)*"|-?\d+|[A-Za-z*][A-Za-z0-9:/_.*+-]*)/gi)) {
      const raw = p[2]!;
      params[p[1]!.toLowerCase()] = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : /^-?\d+$/.test(raw) ? Number(raw) : raw;
    }
    out.push({ label: m[1]!, components, params, raw: m[2]! });
  }
  return out;
}

export function parseSignature(header: string | null): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  if (!header) return out;
  for (const member of splitTopLevel(header)) {
    const m = /^\s*([a-z*][a-z0-9_.*-]*)=:([A-Za-z0-9+/=]*):\s*$/i.exec(member);
    if (m) out.set(m[1]!, Buffer.from(m[2]!, "base64"));
  }
  return out;
}

// ---------------------------------------------------------------- Signature base (RFC 9421 §2.5)

export type Message = { method: string; url: string; headers: Headers };

function authority(url: URL): string {
  // Host in lower case; the port only when it is not the scheme's default.
  return url.host.toLowerCase();
}

/** Builds the signature base, or null if a component cannot be produced (unknown or missing). */
export function signatureBase(message: Message, input: Pick<SignatureInput, "components" | "raw">): string | null {
  const url = new URL(message.url);
  const lines: string[] = [];
  for (const component of input.components) {
    let value: string | null;
    if (component.includes(";")) return null; // component parameters are not used by pawaPay
    switch (component) {
      case "@method":
        value = message.method.toUpperCase();
        break;
      case "@authority":
        value = authority(url);
        break;
      case "@path":
        value = url.pathname || "/";
        break;
      case "@target-uri":
        value = url.toString();
        break;
      case "@query":
        value = url.search || "?";
        break;
      default:
        if (component.startsWith("@")) return null;
        value = message.headers.get(component);
    }
    if (value === null) return null;
    lines.push(`"${component}": ${value.trim()}`);
  }
  lines.push(`"@signature-params": ${input.raw}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- Keys, signing and verification

export function algorithmForKey(key: KeyObject): SignatureAlgorithm {
  if (key.asymmetricKeyType === "ec") {
    const curve = key.asymmetricKeyDetails?.namedCurve;
    if (curve === "prime256v1" || curve === "P-256") return "ecdsa-p256-sha256";
    if (curve === "secp384r1" || curve === "P-384") return "ecdsa-p384-sha384";
  }
  if (key.asymmetricKeyType === "rsa" || key.asymmetricKeyType === "rsa-pss") return "rsa-pss-sha512";
  throw new Error("Unsupported signing key: use EC P-256, EC P-384 or RSA");
}

/** Accepts a PEM given with real or escaped ("\n") newlines, as environment files often carry it. */
export function parsePrivateKey(pem: string): KeyObject {
  return createPrivateKey(pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem);
}

export function parsePublicKey(pem: string): KeyObject {
  return createPublicKey(pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem);
}

function cryptoOptions(alg: SignatureAlgorithm, key: KeyObject, dsaEncoding: "der" | "ieee-p1363") {
  if (alg.startsWith("ecdsa")) return { key, dsaEncoding };
  if (alg === "rsa-pss-sha512") return { key, padding: 6 /* RSA_PKCS1_PSS_PADDING */, saltLength: 64 };
  return { key };
}

export function signBase(base: string, alg: SignatureAlgorithm, privateKey: KeyObject): Buffer {
  return sign(HASH[alg], Buffer.from(base, "utf8"), cryptoOptions(alg, privateKey, "der"));
}

export function verifyBase(base: string, signature: Buffer, alg: string, publicKey: KeyObject): boolean {
  if (!(alg in HASH)) return false;
  const algorithm = alg as SignatureAlgorithm;
  const data = Buffer.from(base, "utf8");
  try {
    if (verify(HASH[algorithm], data, cryptoOptions(algorithm, publicKey, "der"), signature)) return true;
  } catch {
    // not DER: try the raw r||s form below
  }
  if (!algorithm.startsWith("ecdsa")) return false;
  try {
    return verify(HASH[algorithm], data, cryptoOptions(algorithm, publicKey, "ieee-p1363"), signature);
  } catch {
    return false;
  }
}

/** Headers for a signed request to pawaPay (Content-Digest, Signature-Date, Signature-Input, Signature). */
export function signRequest(input: { method: string; url: string; body: string; contentType: string; keyId: string; privateKey: KeyObject; now: Date; ttlSeconds?: number }): Record<string, string> {
  const alg = algorithmForKey(input.privateKey);
  const created = Math.floor(input.now.getTime() / 1000);
  const headers = new Headers({
    "content-type": input.contentType,
    "content-digest": contentDigest(input.body, "sha-512"),
    "signature-date": input.now.toISOString(),
  });
  const keyId = input.keyId.replace(/["\\]/g, "");
  const raw = `(${REQUEST_COMPONENTS.map((c) => `"${c}"`).join(" ")});alg="${alg}";keyid="${keyId}";created=${created};expires=${created + (input.ttlSeconds ?? 60)}`;
  const base = signatureBase({ method: input.method, url: input.url, headers }, { components: [...REQUEST_COMPONENTS], raw });
  if (!base) throw new Error("Could not build the request signature base");
  return {
    "Content-Digest": headers.get("content-digest")!,
    "Signature-Date": headers.get("signature-date")!,
    "Signature-Input": `${SIGNATURE_LABEL}=${raw}`,
    Signature: `${SIGNATURE_LABEL}=:${signBase(base, alg, input.privateKey).toString("base64")}:`,
  };
}
