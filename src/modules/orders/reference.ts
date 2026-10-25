import { randomInt } from "node:crypto";

// Human-readable order reference. It is an alias for conversations with support,
// never an authorization: random (not sequential) so it does not reveal volume.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"; // no 0/O, 1/I/L, U

export function newOrderReference(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `BB-${s.slice(0, 4)}-${s.slice(4)}`;
}
