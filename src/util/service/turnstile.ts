import { HttpError } from "../HttpError";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface SiteVerifyResponse {
    success: boolean;
    "error-codes"?: string[];
}

/**
 * Cloudflare Turnstile のトークンを検証する。
 * bot による大量登録を防ぐための人間確認に使う。
 */
export class TurnstileService {
    private secret: string;

    public constructor(secret: string) {
        this.secret = secret;
    }

    /**
     * トークンを検証する。通らなければ 403 を投げる
     * @param token クライアントが取得した Turnstile トークン
     * @param remoteIp 接続元IP (任意だが渡すと精度が上がる)
     */
    public async verify(token: string | undefined, remoteIp?: string | null): Promise<void> {
        if (!token) throw HttpError.createForbidden("Turnstile token is required");

        const body = new FormData();
        body.append("secret", this.secret);
        body.append("response", token);
        if (remoteIp) body.append("remoteip", remoteIp);

        const res = await fetch(VERIFY_URL, { method: "POST", body });
        const data = await res.json() as SiteVerifyResponse;

        if (!data.success) throw HttpError.createForbidden("Turnstile verification failed");
    }
}
