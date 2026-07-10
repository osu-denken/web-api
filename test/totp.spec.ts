import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpCode, TOTP_PERIOD, verifyTotp } from "../src/util/totp";

// RFC 6238 Appendix B のシークレット "12345678901234567890" (ASCII) を Base32 にしたもの
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

const stepFor = (unixSeconds: number) => Math.floor(unixSeconds / TOTP_PERIOD);

describe("base32", () => {
    it("round-trips arbitrary bytes", () => {
        const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
        expect(Array.from(base32Decode(base32Encode(bytes)))).toEqual(Array.from(bytes));
    });

    it("encodes the RFC 6238 secret", () => {
        const ascii = new TextEncoder().encode("12345678901234567890");
        expect(base32Encode(ascii)).toBe(RFC_SECRET);
    });
});

describe("generateTotpCode", () => {
    // RFC 6238 Appendix B (SHA-1) の下位6桁
    it.each([
        [59, "287082"],
        [1111111109, "081804"],
        [1111111111, "050471"],
        [1234567890, "005924"],
        [2000000000, "279037"],
        [20000000000, "353130"]
    ])("matches the RFC vector at t=%i", async (unixSeconds, expected) => {
        expect(await generateTotpCode(RFC_SECRET, stepFor(unixSeconds))).toBe(expected);
    });
});

describe("verifyTotp", () => {
    it("accepts the current code", async () => {
        const now = Math.floor(Date.now() / 1000 / TOTP_PERIOD);
        const code = await generateTotpCode(RFC_SECRET, now);

        expect(await verifyTotp(RFC_SECRET, code)).toBe(now);
    });

    it("tolerates a one step clock skew", async () => {
        const now = Math.floor(Date.now() / 1000 / TOTP_PERIOD);

        expect(await verifyTotp(RFC_SECRET, await generateTotpCode(RFC_SECRET, now - 1))).toBe(now - 1);
        expect(await verifyTotp(RFC_SECRET, await generateTotpCode(RFC_SECRET, now + 1))).toBe(now + 1);
    });

    it("rejects a code from outside the window", async () => {
        const now = Math.floor(Date.now() / 1000 / TOTP_PERIOD);

        expect(await verifyTotp(RFC_SECRET, await generateTotpCode(RFC_SECRET, now - 2))).toBeNull();
    });

    it("rejects a code that was already used", async () => {
        const now = Math.floor(Date.now() / 1000 / TOTP_PERIOD);
        const code = await generateTotpCode(RFC_SECRET, now);

        expect(await verifyTotp(RFC_SECRET, code, now)).toBeNull();
    });

    it("rejects malformed input", async () => {
        expect(await verifyTotp(RFC_SECRET, "12345")).toBeNull();
        expect(await verifyTotp(RFC_SECRET, "abcdef")).toBeNull();
    });
});
