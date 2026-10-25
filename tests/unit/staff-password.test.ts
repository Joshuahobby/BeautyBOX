import { describe, expect, it } from "vitest";
import { linkProblemFromCode, passwordProblem, readResetLink, STAFF_PASSWORD_MAX_BYTES, STAFF_PASSWORD_MIN } from "@/lib/staff-password";

describe("staff password rules", () => {
  it("needs at least 12 characters, at most 72 bytes, typed the same twice", () => {
    expect(passwordProblem("short", "short")).toMatch(/at least 12/);
    expect(passwordProblem("x".repeat(STAFF_PASSWORD_MIN), "x".repeat(STAFF_PASSWORD_MIN))).toBeNull();
    expect(passwordProblem("x".repeat(STAFF_PASSWORD_MAX_BYTES), "x".repeat(STAFF_PASSWORD_MAX_BYTES))).toBeNull();
    expect(passwordProblem("x".repeat(STAFF_PASSWORD_MAX_BYTES + 1), "x".repeat(STAFF_PASSWORD_MAX_BYTES + 1))).toMatch(/at most 72 bytes/);
    expect(passwordProblem("a long enough one", "a long enough two")).toMatch(/do not match/);
  });

  it("measures the upper limit in bytes, as bcrypt does", () => {
    const accented = "é".repeat(40); // 40 characters, 80 bytes
    expect(passwordProblem(accented, accented)).toMatch(/at most 72 bytes/);
  });
});

describe("reset links", () => {
  const base = "http://localhost:3000/staff/reset-password";

  it("recognises a working link by its code", () => {
    expect(readResetLink(`${base}?code=abc`)).toEqual({ hasCode: true, problem: null });
    expect(readResetLink(base)).toEqual({ hasCode: false, problem: null });
  });

  it("reads Supabase link errors from the query or the fragment", () => {
    expect(readResetLink(`${base}?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`).problem).toBe("expired");
    expect(readResetLink(`${base}#error=access_denied&error_code=otp_expired`).problem).toBe("expired");
    expect(readResetLink(`${base}?error=server_error`).problem).toBe("invalid");
  });

  it("maps exchange error codes", () => {
    expect(linkProblemFromCode("flow_state_expired")).toBe("expired");
    expect(linkProblemFromCode("bad_code_verifier")).toBe("invalid");
    expect(linkProblemFromCode(undefined)).toBe("invalid");
  });
});
