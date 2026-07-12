import { Env } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface FMObj {
  meta: Record<string, any>;
  content: string;
}

/**
 * Markdownのソース(FrontMatter)からメタ部分とコンテンツ部分にわけてメタデータを作成する。
 * @param source Markdown記法のソース
 * @returns { content: コンテンツ, meta: メタデータ }
 */
export function parseFrontMatter(source: string): FMObj {
    const res: FMObj = { meta: {}, content: source };

    if (!source.startsWith('---')) return res;

    const endIndex = source.indexOf('---', 3);
    if (endIndex === -1) return res;

    const metaString = source.slice(3, endIndex).trim();
    const body = source.slice(endIndex + 3).trim();

    const lines = metaString.split('\n');

    for (const line of lines) {
        const i = line.indexOf(":");
        if (i === -1)
            continue;
        
        const key = line.slice(0, i).trim();
        const valueRaw = line.slice(i + 1).trim();

        let value: any = valueRaw;
        if (valueRaw.startsWith('[') && valueRaw.endsWith(']')) {
            const arrayValues = valueRaw
                .slice(1, -1)
                .split(',')
                .map(v => v.trim())
                .filter(v => v.length > 0);
            value = arrayValues;
        }

        res.meta[key] = value;
    }

    res.content = body;
    return res;
}

/**
 * メタデータとコンテンツからFrontMatterを作成する
 * @param meta メタデータ
 * @param content コンテンツ
 * @returns FrontMatterのMDソース
 */
export function createFrontMatter(meta: Record<string, any>, content: string): string {
    const lines: string[] = ['---'];

    for (const [key, value] of Object.entries(meta)) {
        if (Array.isArray(value)) {
        lines.push(`${key}: [${value.join(', ')}]`);
        } else {
        lines.push(`${key}: ${value}`);
        }
    }

    lines.push('---', '', content);

    return lines.join('\n');
}

export function FMObj2FrontMatterString(fm: FMObj): string {
  return createFrontMatter(fm.meta, fm.content);
}

/**
 * to Base64
 * @param data 
 * @returns 
 */
export function toBase64(data: string | ArrayBuffer | Uint8Array): string {
    let u8: Uint8Array;

    if (typeof data === 'string') {
        u8 = encoder.encode(data);
    } else if (data instanceof ArrayBuffer) {
        u8 = new Uint8Array(data);
    } else {
        u8 = data;
    }

    let bin = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < u8.length; i += chunkSize)
        bin += String.fromCharCode(...u8.subarray(i, i + chunkSize));
    
    return btoa(bin);
}

/**
 * Base64 to Uint8Array
 * @param b64 Base64
 * @returns Uint8Array
 */
export function b64ToU8(b64: string): Uint8Array {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        u8[i] = bin.charCodeAt(i);
    
    return u8;
}

/**
 * Base64 to string
 * @param b64 Base64
 * @returns 文字列
 */
export function b64ToStr(b64: string): string {
    return decoder.decode(b64ToU8(b64));
}

/**
 * KVへログを出力する。
 * @param request 
 * @param env 
 * @param type 
 * @param message 
 * @param ttl 
 */
export async function logInfo(request: Request, env: Env, type: string, message: string, ttl = 60 * 60 * 24 * 365) { // default: 365 days
	const ts = Date.now();
	const ip = request.headers.get("CF-Connecting-IP") || "unknown";
	const userAgent = request.headers.get("User-Agent") || "unknown";

	// キーは `${type}:${反転タイムスタンプ}` とし、KV の昇順リストで新しい順に並ぶようにする。
	// list() はメタデータを返すので、閲覧側は値を都度 get せずに一覧を組める。
	const invTs = String(1e15 - ts).padStart(15, "0");
	const meta = { type, ts, message, ip, userAgent };

	await env.LOGS.put(`${type}:${invTs}`, JSON.stringify(meta, null, 2), {
		expirationTtl: ttl,
		metadata: meta,
	});
}

/**
 * Jsonのレスポンスを作成する
 * @param data オブジェクト
 * @param status ステータスコード
 * @returns Response
 */
export function createJsonResponse(data: any, status = 200) {
    return new Response(JSON.stringify(data, null, 2), 
    {
        status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        }
    });
}

/**
 * SHA256ハッシュ化
 * @param data ハッシュ値のもととなる値
 * @returns ハッシュ値
 */
export function sha256(data: string): Promise<string> {
    const buf = encoder.encode(data);
    return crypto.subtle.digest("SHA-256", buf).then((hashBuf) => {
        const hashArray = Array.from(new Uint8Array(hashBuf));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    });
}

/**
 * 招待コード生成
 * @param length コードの長さ
 * @returns 招待コード
 */
export function generateInviteCode(length = 8): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    // 256 を chars.length で割り切れる最大値。これ以上の値を捨てることでモジュロバイアスを避ける
    const limit = 256 - (256 % chars.length);

    let code = "";
    while (code.length < length) {
        // 招待コードは登録の関門なので、予測可能な Math.random ではなく CSPRNG を使う
        const bytes = crypto.getRandomValues(new Uint8Array(length));

        for (const byte of bytes) {
            if (byte >= limit) continue;
            code += chars[byte % chars.length];
            if (code.length === length) break;
        }
    }

    return code;
}

/**
 * 秘密情報の比較 (タイミング攻撃対策)
 * @param a 比較対象
 * @param b 比較対象
 * @returns 一致するかどうか
 */
export function timingSafeEqual(a: string, b: string): boolean {
    const aBytes = encoder.encode(a);
    const bBytes = encoder.encode(b);

    if (aBytes.length !== bBytes.length) return false;

    let diff = 0;
    for (let i = 0; i < aBytes.length; i++)
        diff |= aBytes[i] ^ bBytes[i];

    return diff === 0;
}

/**
 * パスワードとソルトからAES-GCMの鍵とIVを生成
 * @param pass 暗号化/復号化用のパスワード
 * @param salt ソルトのUnit8Array
 * @param type encrypt or decrypt
 * @returns { key: CryptoKEy, iv: Uint8Array } 暗号化鍵とIV(初期ベクトル)
 */
async function deriveKeyAndIv(pass: string, salt: Uint8Array, type: ("encrypt" | "decrypt")[]) {
    const km = await crypto.subtle.importKey("raw", encoder.encode(pass), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, km, 512));

    return {key: await crypto.subtle.importKey("raw", bits.slice(0, 32), "AES-GCM", false, type),
        iv: bits.slice(32, 44)};
}

/**
 * 暗号化 (ソルト自動生成)
 * @param plain 平文
 * @param pass 暗号化パスワード
 * @returns <base64のsalt>.<base64の暗号文>
 */
export async function encrypt(plain: string, pass: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const { key, iv } = await deriveKeyAndIv(pass, salt, ["encrypt"]);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plain));

    return `${toBase64(salt)}.${toBase64(encrypted)}`;
}

/**
 * 復号化
 * @param encoded <base64のsalt>.<base64の暗号文>
 * @param pass 暗号化パスワード
 * @returns 平文
 */
export async function decrypt(encoded: string, pass: string): Promise<string> {
    const [encodedSalt, encodedEncrypted] = encoded.split(".");
    if (!encodedSalt || !encodedEncrypted) throw new Error("invalid format");

    const { key, iv } = await deriveKeyAndIv(pass, b64ToU8(encodedSalt), ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, b64ToU8(encodedEncrypted));

    return decoder.decode(decrypted);
}
