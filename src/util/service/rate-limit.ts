import { Env } from "../types";
import { HttpError } from "../HttpError";

/** 制限の単位。窓の長さと、その窓で許す回数 */
export interface RateLimitRule {
    windowSeconds: number;
    limit: number;
}

/** KV に入る窓の状態 */
interface RateLimitWindow {
    count: number;
    /** 窓が切れる時刻 (UNIX秒) */
    expiresAt: number;
}

/**
 * 認証まわりの窓。総当たりを遅くしつつ、打ち間違いは許す。
 * 学内は NAT 越しで同一IPに見えるため、アカウント単位の窓を主にし、
 * IP単位の窓はアカウントを変えながら試す相手を止めるために緩く重ねる
 */
export const RATE_LIMITS: Record<string, RateLimitRule> = {
    login: { windowSeconds: 5 * 60, limit: 10 },
    loginIp: { windowSeconds: 5 * 60, limit: 100 },
    register: { windowSeconds: 60 * 60, limit: 5 },
    registerIp: { windowSeconds: 60 * 60, limit: 30 },
    resetPassword: { windowSeconds: 60 * 60, limit: 5 },
    resetPasswordIp: { windowSeconds: 60 * 60, limit: 30 }
};

/**
 * KV の固定窓カウンタによるレート制限。
 * KV は結合性が弱く、同時に来た要求を数え落とすことがある。
 * 厳密な上限ではなく、総当たりを非現実的な速度まで落とすためのものとして使う。
 */
export class RateLimiter {
    private kv: KVNamespace;

    public constructor(env: Env) {
        this.kv = env.CACHE;
    }

    /**
     * 発信元を識別する。Cloudflare が付ける接続元IPを信頼する
     * @param request 受け取った要求
     */
    private static clientId(request: Request): string {
        return request.headers.get("CF-Connecting-IP") ?? "unknown";
    }

    /**
     * 1回分を数える。窓の上限を超えていれば 429 を投げる
     * @param request 受け取った要求
     * @param action RATE_LIMITS のキー
     * @param subject 数える単位。省略すると接続元IPで数える
     */
    public async consume(request: Request, action: keyof typeof RATE_LIMITS, subject?: string): Promise<void> {
        const rule = RATE_LIMITS[action];
        if (!rule) throw HttpError.createInternalServerError(`Unknown rate limit action: ${action}`);

        const key = `rl:${action}:${subject ?? RateLimiter.clientId(request)}`;
        const now = Math.floor(Date.now() / 1000);

        const stored = await this.kv.get<RateLimitWindow>(key, "json");
        const window = stored && stored.expiresAt > now
            ? stored
            : { count: 0, expiresAt: now + rule.windowSeconds };

        if (window.count >= rule.limit)
            throw HttpError.createTooManyRequests("Too many attempts, please try again later");

        window.count++;

        // 窓の起点は最初の1回。TTL を延ばすと窓が滑って上限が緩むので、残り時間だけ生かす
        // KV の TTL は 60 秒が下限
        const ttl = Math.max(window.expiresAt - now, 60);
        await this.kv.put(key, JSON.stringify(window), { expirationTtl: ttl });
    }
}
