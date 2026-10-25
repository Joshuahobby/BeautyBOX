// Client-side convenience only: turns common Rwanda formats into the canonical
// +2507XXXXXXXX the API expects. The server re-validates against current operator
// ranges and never infers the wallet operator from the prefix.
export function toCanonicalRwandaPhone(input: string): string | null {
  const digits = input.replace(/[\s().-]/g, "");
  let candidate = digits;
  if (/^07\d{8}$/.test(digits)) candidate = `+250${digits.slice(1)}`;
  else if (/^2507\d{8}$/.test(digits)) candidate = `+${digits}`;
  else if (/^7\d{8}$/.test(digits)) candidate = `+250${digits}`;
  return /^\+2507\d{8}$/.test(candidate) ? candidate : null;
}

export function displayRwandaPhone(e164: string): string {
  const m = /^\+250(7\d{2})(\d{3})(\d{3})$/.exec(e164);
  return m ? `+250 ${m[1]} ${m[2]} ${m[3]}` : e164;
}
