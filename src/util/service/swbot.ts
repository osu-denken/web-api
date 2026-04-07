import { toBase64 } from "../utils";

export class SwitchBotService {
    private token: string;
    private clientSecret: string;

    public constructor(token: string, clientSecret: string) {
        this.token = token;
        this.clientSecret = clientSecret;
    }

    private signatureCache: { t: string; nonce: string; sign: string } | null = null;

    public async getSignature(): Promise<{ t: string; nonce: string; sign: string }> {
        if (this.signatureCache) {
            return this.signatureCache;
        }

        const time = Date.now().toString();
        const nonce = crypto.randomUUID();
        const data = this.token + time + nonce;

        const encoder = new TextEncoder();
        const key = encoder.encode(this.clientSecret);
        const msg = encoder.encode(data);

        const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const rawSign = await crypto.subtle.sign("HMAC", cryptoKey, msg);
        
        const sign = toBase64(rawSign).toUpperCase();

        this.signatureCache = { t: time, nonce, sign };

        return { t: time, nonce, sign };
    }

    public async request(endpoint: string, method: string, body?: any) {
        return this.requestRaw(`https://api.switch-bot.com/v1.1/${endpoint}`, method, body);
    }

    private async requestRaw(url: string, method: string, body?: any) {
        const headers: Record<string, string> = {
            "Authorization": `${this.token}`,
            "Content-Type": "application/json",
            "User-Agent": "osu-denken-admin-cloudflare-worker"
        };

        const { t, nonce, sign } = await this.getSignature();
        headers["t"] = t;
        headers["nonce"] = nonce;
        headers["sign"] = sign;

        return fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });
    }
}