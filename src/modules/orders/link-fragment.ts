// Reads a private-link token from the URL fragment (browser-safe, no server code). Two forms:
// "#token=<token>" (links shown in the browser, /order-access) and "#<token>" (links sent by
// SMS, /o, DR-049). Tokens are base64url, so anything after the first other character is not
// part of it: a phone's linkifier may glue a full stop or bracket onto the end of a link.

export function tokenFromFragment(hash: string): string | null {
  const raw = hash.replace(/^#/, "");
  const value = raw.startsWith("token=") ? (new URLSearchParams(raw).get("token") ?? "") : raw;
  const token = /^[A-Za-z0-9_-]*/.exec(value)?.[0] ?? "";
  return token.length > 0 ? token : null;
}
