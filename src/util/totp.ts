import { timingSafeEqual } from "./utils";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 6238 の既定値。認証アプリはこの値を前提にしている */
export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;

/** 前後1ステップ (±30秒) までは時計ずれとして許容する */
export const TOTP_WINDOW = 1;

/**
 * Base32 エンコード (RFC 4648, パディングなし)
 * @param bytes バイト列
 */
export function base32Encode(bytes: Uint8Array): string {
    let bits = 0;
    let value = 0;
    let out = "";

    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;

        while (bits >= 5) {
            out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }

    if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];

    return out;
}

/**
 * Base32 デコード (RFC 4648)
 * @param encoded Base32 文字列 (パディングと空白は無視する)
 */
export function base32Decode(encoded: string): Uint8Array {
    const normalized = encoded.toUpperCase().replace(/[=\s]/g, "");

    let bits = 0;
    let value = 0;
    const out: number[] = [];

    for (const char of normalized) {
        const index = BASE32_ALPHABET.indexOf(char);
        if (index === -1) throw new Error("invalid base32 character");

        value = (value << 5) | index;
        bits += 5;

        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }

    return new Uint8Array(out);
}

/**
 * TOTP のシークレットを生成する
 * @returns Base32 エンコードされた 160bit のシークレット
 */
export function generateTotpSecret(): string {
    return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

/**
 * 現在時刻に対応するタイムステップ
 * @param at ミリ秒のエポック時刻 (既定: 現在時刻)
 */
export function currentTimeStep(at: number = Date.now()): number {
    return Math.floor(at / 1000 / TOTP_PERIOD);
}

/**
 * HOTP (RFC 4226) を計算する
 * @param secret Base32 のシークレット
 * @param counter カウンタ (TOTP ではタイムステップ)
 */
async function hotp(secret: string, counter: number): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        base32Decode(secret) as unknown as ArrayBuffer,
        { name: "HMAC", hash: "SHA-1" },
        false,
        ["sign"]
    );

    // カウンタは 8 バイトのビッグエンディアン。JS のビット演算は 32bit なので上下に分けて書く
    const counterBytes = new Uint8Array(8);
    new DataView(counterBytes.buffer).setUint32(0, Math.floor(counter / 0x100000000));
    new DataView(counterBytes.buffer).setUint32(4, counter >>> 0);

    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes as unknown as ArrayBuffer));

    // dynamic truncation
    const offset = mac[mac.length - 1] & 0x0f;
    const binary =
        ((mac[offset] & 0x7f) << 24) |
        (mac[offset + 1] << 16) |
        (mac[offset + 2] << 8) |
        mac[offset + 3];

    return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, "0");
}

/**
 * 指定したタイムステップの TOTP コードを求める
 * @param secret Base32 のシークレット
 * @param step タイムステップ
 */
export function generateTotpCode(secret: string, step: number): Promise<string> {
    return hotp(secret, step);
}

/**
 * TOTP コードを検証する
 * @param secret Base32 のシークレット
 * @param code 利用者が入力したコード
 * @param lastUsedStep 直近で受理したタイムステップ (コードの使い回しを防ぐ)
 * @returns 受理したタイムステップ。不一致なら null
 */
export async function verifyTotp(secret: string, code: string, lastUsedStep?: number): Promise<number | null> {
    const normalized = code.replace(/\s/g, "");
    if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(normalized)) return null;

    const now = currentTimeStep();

    for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset++) {
        const step = now + offset;

        // 一度受理したコードは有効期間内でも再利用させない
        if (lastUsedStep !== undefined && step <= lastUsedStep) continue;

        const expected = await generateTotpCode(secret, step);
        if (timingSafeEqual(expected, normalized)) return step;
    }

    return null;
}

/**
 * 認証アプリに読ませる otpauth URI を組み立てる
 * @param secret Base32 のシークレット
 * @param account アカウント名 (メールアドレスなど)
 * @param issuer サービス名
 */
export function otpauthUrl(secret: string, account: string, issuer: string): string {
    const label = encodeURIComponent(`${issuer}:${account}`);
    const params = new URLSearchParams({
        secret,
        issuer,
        algorithm: "SHA1",
        digits: String(TOTP_DIGITS),
        period: String(TOTP_PERIOD)
    });

    return `otpauth://totp/${label}?${params.toString()}`;
}
