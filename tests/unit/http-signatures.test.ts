import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  algorithmForKey,
  contentDigest,
  contentDigestMatches,
  parseSignature,
  parseSignatureInput,
  signatureBase,
  signRequest,
  verifyBase,
} from "@/adapters/payments/http-signatures";

// RFC 9421 / 9530 as pawaPay uses them (DR-042). The first two tests use vectors copied
// from pawaPay's documentation (docs.pawapay.io/v2/docs/signatures, reviewed 2026-10-24).

describe("pawaPay documentation vectors", () => {
  it("the documented signed response body matches its documented Content-Digest", () => {
    const body = Buffer.from('{"depositId":"d6df5c10-bd43-408c-b622-f10f9eaa568b","status":"ACCEPTED","created":"2024-05-02T12:36:46Z"}');
    const header = "sha-512=:NkvHr2fjqMoKW6nxA6V6jeQXhZyKVAcYdOv6Rmpa2cMn7yZmYDFrPzj/1LiAvOmJkCEdfsS5Bn9N/uZL8nCLZQ==:";
    expect(contentDigestMatches(header, body)).toBe(true);
    expect(contentDigest(body)).toBe(header);
    expect(contentDigestMatches(header, Buffer.from(body.toString().replace("ACCEPTED", "COMPLETED")))).toBe(false);
  });

  it("rebuilds the documented callback signature base exactly", () => {
    const signatureInput =
      'sig-pp=("@method" "@authority" "@path" "signature-date" "content-digest" "content-type");alg="ecdsa-p256-sha256";keyid="CUSTOMER_TEST_KEY";created=1714657551;expires=1714657611';
    const [input] = parseSignatureInput(signatureInput);
    expect(input).toMatchObject({
      label: "sig-pp",
      components: ["@method", "@authority", "@path", "signature-date", "content-digest", "content-type"],
      params: { alg: "ecdsa-p256-sha256", keyid: "CUSTOMER_TEST_KEY", created: 1714657551, expires: 1714657611 },
    });
    const headers = new Headers({
      "content-type": "application/json; charset=UTF-8",
      "content-digest": "sha-512=:0ki7QBS/0MA424uwOq3k5HnJnL5SRkPjit12m0YMpd4JgWiMvm9+yNT3FunkpDaTSsKhTkliQwJlRw9bgsos9w==:",
      "signature-date": "2024-05-02T16:45:51.131905Z",
    });
    const base = signatureBase({ method: "POST", url: "http://localhost:8080/callback", headers }, input!);
    expect(base).toBe(
      [
        '"@method": POST',
        '"@authority": localhost:8080',
        '"@path": /callback',
        '"signature-date": 2024-05-02T16:45:51.131905Z',
        '"content-digest": sha-512=:0ki7QBS/0MA424uwOq3k5HnJnL5SRkPjit12m0YMpd4JgWiMvm9+yNT3FunkpDaTSsKhTkliQwJlRw9bgsos9w==:',
        '"content-type": application/json; charset=UTF-8',
        '"@signature-params": ("@method" "@authority" "@path" "signature-date" "content-digest" "content-type");alg="ecdsa-p256-sha256";keyid="CUSTOMER_TEST_KEY";created=1714657551;expires=1714657611',
      ].join("\n"),
    );
    expect(parseSignature("sig-pp=:MEQCIHFvGCUgyxmmowMufO4Yk20pBs3JHRax81si2QZVi9ByAiBPpg1WBhQjZ6fmi3a/gKcWiQ73Qm9Ol35On3c4K/flew==:").get("sig-pp")?.length).toBe(70);
  });
});

describe("signing and verifying", () => {
  const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });

  function signedRequest(privateKey = ec.privateKey) {
    const body = JSON.stringify({ depositId: "3f1b0c2e-7a7e-4c39-9d5f-2f1a7c1e8b10", amount: "1000", currency: "RWF" });
    const url = "https://api.sandbox.pawapay.io/v2/deposits";
    const headers = signRequest({ method: "POST", url, body, contentType: "application/json; charset=UTF-8", keyId: "BB_KEY_1", privateKey, now: new Date("2026-10-24T10:00:00Z") });
    return { body, url, headers: new Headers({ ...headers, "content-type": "application/json; charset=UTF-8" }) };
  }

  it("signs requests the way pawaPay documents, and they verify", () => {
    const { body, url, headers } = signedRequest();
    expect(headers.get("signature-input")).toBe(
      'sig-pp=("@method" "@authority" "@path" "signature-date" "content-digest" "content-type");alg="ecdsa-p256-sha256";keyid="BB_KEY_1";created=1792836000;expires=1792836060',
    );
    expect(contentDigestMatches(headers.get("content-digest"), Buffer.from(body))).toBe(true);
    const input = parseSignatureInput(headers.get("signature-input"))[0]!;
    const signature = parseSignature(headers.get("signature")).get("sig-pp")!;
    expect(signature[0]).toBe(0x30); // DER, as pawaPay's examples and sample code use
    const base = signatureBase({ method: "POST", url, headers }, input)!;
    expect(verifyBase(base, signature, "ecdsa-p256-sha256", ec.publicKey)).toBe(true);
    // Anything else in the base breaks it: another path, host or body.
    expect(verifyBase(signatureBase({ method: "POST", url: url.replace("/deposits", "/refunds"), headers }, input)!, signature, "ecdsa-p256-sha256", ec.publicKey)).toBe(false);
    expect(verifyBase(signatureBase({ method: "POST", url: url.replace("api.sandbox", "evil"), headers }, input)!, signature, "ecdsa-p256-sha256", ec.publicKey)).toBe(false);
    expect(verifyBase(base, signature, "ecdsa-p256-sha256", generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey)).toBe(false);
  });

  it("accepts the raw r||s ECDSA form RFC 9421 describes as well as DER", () => {
    const base = '"@method": POST\n"@signature-params": ("@method");alg="ecdsa-p256-sha256";keyid="k";created=1';
    const raw = sign("sha256", Buffer.from(base), { key: ec.privateKey, dsaEncoding: "ieee-p1363" });
    expect(raw.length).toBe(64);
    expect(verifyBase(base, raw, "ecdsa-p256-sha256", ec.publicKey)).toBe(true);
  });

  it("supports P-384 and RSA-PSS keys and refuses unknown algorithms", () => {
    const p384 = generateKeyPairSync("ec", { namedCurve: "P-384" });
    expect(algorithmForKey(p384.privateKey)).toBe("ecdsa-p384-sha384");
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(algorithmForKey(rsa.privateKey)).toBe("rsa-pss-sha512");
    const { url, headers } = signedRequest(rsa.privateKey);
    const input = parseSignatureInput(headers.get("signature-input"))[0]!;
    const base = signatureBase({ method: "POST", url, headers }, input)!;
    expect(verifyBase(base, parseSignature(headers.get("signature")).get("sig-pp")!, "rsa-pss-sha512", rsa.publicKey)).toBe(true);
    expect(verifyBase(base, Buffer.alloc(10), "hmac-sha256", rsa.publicKey)).toBe(false);
  });

  it("refuses a missing or unsupported digest and components it cannot build", () => {
    expect(contentDigestMatches(null, Buffer.from("x"))).toBe(false);
    expect(contentDigestMatches("md5=:abc=:", Buffer.from("x"))).toBe(false);
    const [input] = parseSignatureInput('sig-pp=("@method" "x-missing");alg="ecdsa-p256-sha256";keyid="k";created=1');
    expect(signatureBase({ method: "POST", url: "https://shop.example/cb", headers: new Headers() }, input!)).toBeNull();
  });
});
