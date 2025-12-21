import { Env } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface FMObj {
  meta: Record<string, any>;
  content: string;
}

export function parseFrontMatter(source: string): FMObj {
  const res: FMObj = { meta: {}, content: source };

  if (!source.startsWith('---')) return res;

  const endIndex = source.indexOf('---', 3);
  if (endIndex === -1) return res;

  const metaString = source.slice(3, endIndex).trim();
  const body = source.slice(endIndex + 3).trim();

  const lines = metaString.split('\n');

  for (const line of lines) {
    if (!line.includes(':')) continue;

    const [key, ...rest] = line.split(':');
    if (!key) continue;

    const valueRaw = rest.join(':').trim();

    let value: any = valueRaw;
    if (valueRaw.startsWith('[') && valueRaw.endsWith(']')) {
      const arrayValues = valueRaw
        .slice(1, -1)
        .split(',')
        .map(v => v.trim())
        .filter(v => v.length > 0);
      value = arrayValues;
    }

    res.meta[key.trim()] = value;
  }

  res.content = body;
  return res;
}

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

export function txt2base64(str: string) {
	const bytes = new TextEncoder().encode(str);
	let bin = '';
	for (let i = 0; i < bytes.length; i++) {
		bin += String.fromCharCode(bytes[i]);
	}
	return btoa(bin);
}

export function base642txt(base64: string) {
    const decodedContent = atob(base64);
    const bytes = new Uint8Array(decodedContent.length);
    for (let i = 0; i < decodedContent.length; i++) {
        bytes[i] = decodedContent.charCodeAt(i);
    }
    return decoder.decode(bytes);
}

export function arrayBuffer2base64(buffer: ArrayBuffer) {
    let bin = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }

    return btoa(bin);
}

export function u82Base64(u8: Uint8Array): string {
  let bin = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < u8.length; i += chunkSize) {
    bin += String.fromCharCode(...u8.subarray(i, i + chunkSize));
  }
  return btoa(bin);
}

export function base642U8(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    u8[i] = bin.charCodeAt(i);
  }
  return u8;
}


export async function logInfo(request: Request, env: Env, type: string, message: string, ttl = 60 * 60 * 24 * 365) { // default: 365 days
	await env.LOGS.put(`${type}:${Date.now()}`, JSON.stringify(
		{ 
		    message,
		    ip: request.headers.get("CF-Connecting-IP") || "unknown",
		    userAgent: request.headers.get("User-Agent") || "unknown",
		}, null, 2
	), { expirationTtl: ttl });
}

export function createJsonResponse2(status: number, statusText: string, body: any) {
	return new Response(
		JSON.stringify(
			{
				status,
				statusText,
				body
			}, null, 2
		),
		{ 
			status, 
			headers: {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type, Authorization, page",
			} 
		}
	);
}

export function createResponse(status: number, body: any) {
	return new Response(body, 
		{ 
			status, 
			headers: {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type, Authorization, page",
			} 
		}
	);
}

export function createJsonResponse(data: any) {
    return new Response(JSON.stringify(data, null, 2), {
        status: 200,
        headers: {
            "Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
        }
    });
}

export function sha256(data: string): Promise<string> {
    const buf = encoder.encode(data);
    return crypto.subtle.digest("SHA-256", buf).then((hashBuf) => {
        const hashArray = Array.from(new Uint8Array(hashBuf));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    });
}

export function die(msg: string) {
	return createJsonResponse2(500, "Internal Server Error", { error: msg });
}

export function generateInviteCode(length = 8): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let code = "";
    for (let i = 0; i < length; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
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

  const bits = new Uint8Array(await crypto.subtle.deriveBits({name: "PBKDF2", salt, 
    iterations: 100_000, hash: "SHA-256"}, km, 512));

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

  return `${u82Base64(salt)}.${arrayBuffer2base64(encrypted)}`;
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

  const { key, iv } = await deriveKeyAndIv(pass, base642U8(encodedSalt), ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, base642U8(encodedEncrypted));

  return decoder.decode(decrypted);
}
