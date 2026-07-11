import { HttpError } from "../HttpError";
import { Env } from "../types";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "../totp";
import { decrypt, encrypt, generateInviteCode, logInfo, sha256, timingSafeEqual } from "../utils";
import { UserCustomService } from "./user-custom";

/** 2段階認証待ちの猶予。この間にコードを入力しなければログインをやり直す */
const MFA_PENDING_TTL = 5 * 60;

/** 2段階認証のコード入力を試せる回数 */
const MFA_MAX_ATTEMPTS = 5;

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 10;

/** 認証アプリに表示されるサービス名 */
const TOTP_ISSUER = "OSU-Denken";

/**
 * ログイン済みだが 2段階認証がまだ通っていない状態。
 * Firebase のトークンはここに退避し、コードを検証するまでクライアントへ渡さない。
 */
interface MfaPending {
    localId: string;
    email: string;
    idToken: string;
    refreshToken: string;
    displayName?: string;
    attempts: number;
}

/** ログイン時にトークンを退避する対象 */
export interface LoginTokens {
    localId: string;
    email: string;
    idToken: string;
    refreshToken: string;
    displayName?: string;
}

/** 認証を通したあとにクライアントへ渡すトークン */
export interface ResolvedTokens {
    idToken: string;
    refreshToken: string;
    displayName?: string;
    usedRecoveryCode: boolean;
}

/**
 * 2段階認証 (TOTP) の登録・検証・解除。
 * ログイン中の退避トークンは CACHE KV に、シークレットは USER_CUSTOM に持つ。
 */
export class MfaService {
    private env: Env;
    private request: Request;

    public constructor(env: Env, request: Request) {
        this.env = env;
        this.request = request;
    }

    private get userCustom(): UserCustomService {
        return new UserCustomService(this.env);
    }

    private mfaKey(pendingToken: string): string {
        return `mfa:${pendingToken}`;
    }

    /**
     * 2段階認証が有効なら、ログイントークンを退避して待機トークンを返す。
     * 無効ならそのまま通す意味で null を返す
     * @param tokens ログインで得たトークン一式
     */
    public async createPendingIfEnabled(tokens: LoginTokens): Promise<{ mfaPendingToken: string; expiresIn: number } | null> {
        const customData = await this.userCustom.get(tokens.localId);
        if (!customData.totp) return null;

        const mfaPendingToken = generateInviteCode(32);
        const pending: MfaPending = { ...tokens, attempts: 0 };

        await this.env.CACHE.put(this.mfaKey(mfaPendingToken), JSON.stringify(pending), { expirationTtl: MFA_PENDING_TTL });

        return { mfaPendingToken, expiresIn: MFA_PENDING_TTL };
    }

    /**
     * 待機中のコードを検証し、退避しておいたトークンを返す
     * @param mfaPendingToken ログイン時に発行した待機トークン
     * @param code 認証アプリのコードまたはリカバリコード
     */
    public async verifyPending(mfaPendingToken: string, code: string): Promise<ResolvedTokens> {
        const key = this.mfaKey(mfaPendingToken);
        const raw = await this.env.CACHE.get(key);
        if (!raw) throw new HttpError(401, "MFA_PENDING_EXPIRED", "2FA session expired, please login again");

        const pending: MfaPending = JSON.parse(raw);
        const customData = await this.userCustom.get(pending.localId);

        if (!customData.totp) {
            // 待機中に 2段階認証が解除された。トークンをそのまま渡してよい
            await this.env.CACHE.delete(key);
            return { idToken: pending.idToken, refreshToken: pending.refreshToken, displayName: pending.displayName, usedRecoveryCode: false };
        }

        const secret = await decrypt(customData.totp.secretEncoded, this.env.SECRET_KEY);
        const step = await verifyTotp(secret, code, customData.totp.lastUsedStep);
        const usedRecoveryCode = step === null && await this.consumeRecoveryCode(pending.localId, code);

        if (step === null && !usedRecoveryCode) throw await this.rejectAttempt(key, pending);

        if (step !== null) {
            customData.totp.lastUsedStep = step;
            await this.userCustom.put(pending.localId, customData);
        }

        await this.env.CACHE.delete(key);
        await logInfo(this.request, this.env, "login_2fa",
            `Login "${pending.email}" with ${usedRecoveryCode ? "recovery code" : "2FA"}`);

        return { idToken: pending.idToken, refreshToken: pending.refreshToken, displayName: pending.displayName, usedRecoveryCode: Boolean(usedRecoveryCode) };
    }

    /**
     * 失敗した試行を数える。上限に達したら待機を破棄する。投げる HttpError を返す
     */
    private async rejectAttempt(key: string, pending: MfaPending): Promise<HttpError> {
        pending.attempts++;

        if (pending.attempts >= MFA_MAX_ATTEMPTS) {
            await this.env.CACHE.delete(key);
            await logInfo(this.request, this.env, "login_2fa", `2FA locked out for "${pending.email}"`);
            return new HttpError(401, "MFA_TOO_MANY_ATTEMPTS", "Too many attempts, please login again");
        }

        // 残り試行回数を保つため、TTL は延ばさず書き戻す
        await this.env.CACHE.put(key, JSON.stringify(pending), { expirationTtl: MFA_PENDING_TTL });
        return new HttpError(401, "MFA_INVALID_CODE", "Invalid code");
    }

    /**
     * リカバリコードを消費する。使い捨てなので一致したものは削除する
     * @param localId Firebase Local ID
     * @param code 利用者が入力したコード
     * @returns 消費できたかどうか
     */
    private async consumeRecoveryCode(localId: string, code: string): Promise<boolean> {
        const customData = await this.userCustom.get(localId);
        if (!customData.totp) return false;

        const hash = await sha256(code.trim());
        const index = customData.totp.recoveryCodeHashes.findIndex(stored => timingSafeEqual(stored, hash));
        if (index === -1) return false;

        customData.totp.recoveryCodeHashes.splice(index, 1);
        await this.userCustom.put(localId, customData);

        return true;
    }

    /**
     * シークレットを発行する。この時点ではまだ有効化しない
     * @param localId Firebase Local ID
     * @param label 認証アプリに表示するアカウント名 (メールアドレスなど)
     */
    public async setup(localId: string, label: string): Promise<{ secret: string; otpauthUrl: string }> {
        const customData = await this.userCustom.get(localId);
        if (customData.totp) throw new HttpError(409, "MFA_ALREADY_ENABLED", "2FA is already enabled");

        const secret = generateTotpSecret();
        customData.totpPending = {
            secretEncoded: await encrypt(secret, this.env.SECRET_KEY),
            createdAt: new Date().toISOString()
        };
        await this.userCustom.put(localId, customData);

        return { secret, otpauthUrl: otpauthUrl(secret, label, TOTP_ISSUER) };
    }

    /**
     * 認証アプリが正しく登録できたことをコードで確認し、有効化する
     * @param localId Firebase Local ID
     * @param code 認証アプリのコード
     * @returns 平文のリカバリコード (この一度しか渡らない)
     */
    public async enable(localId: string, code: string): Promise<string[]> {
        const customData = await this.userCustom.get(localId);

        if (customData.totp) throw new HttpError(409, "MFA_ALREADY_ENABLED", "2FA is already enabled");
        if (!customData.totpPending) throw new HttpError(400, "MFA_NOT_SETUP", "Call /user/totp/setup first");

        const secret = await decrypt(customData.totpPending.secretEncoded, this.env.SECRET_KEY);
        const step = await verifyTotp(secret, code);
        if (step === null) throw new HttpError(400, "MFA_INVALID_CODE", "Invalid code");

        // 平文はこのレスポンスでしか渡らない。以後はハッシュしか持たない
        const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateInviteCode(RECOVERY_CODE_LENGTH));

        customData.totp = {
            secretEncoded: customData.totpPending.secretEncoded,
            enabledAt: new Date().toISOString(),
            recoveryCodeHashes: await Promise.all(recoveryCodes.map(sha256)),
            lastUsedStep: step
        };
        delete customData.totpPending;

        await this.userCustom.put(localId, customData);
        await logInfo(this.request, this.env, "2fa_enable", `Enable 2FA for "${localId}"`);

        return recoveryCodes;
    }

    /**
     * 2段階認証を解除する
     * @param localId Firebase Local ID
     * @param code 認証アプリのコードまたはリカバリコード
     */
    public async disable(localId: string, code: string): Promise<void> {
        const customData = await this.userCustom.get(localId);
        if (!customData.totp) throw new HttpError(400, "MFA_NOT_ENABLED", "2FA is not enabled");

        // 解除は乗っ取り時の足がかりになるので、有効化と同じくコードの提示を求める
        const secret = await decrypt(customData.totp.secretEncoded, this.env.SECRET_KEY);
        const step = await verifyTotp(secret, code, customData.totp.lastUsedStep);

        if (step === null && !await this.consumeRecoveryCode(localId, code))
            throw new HttpError(400, "MFA_INVALID_CODE", "Invalid code");

        // consumeRecoveryCode が書き換えている可能性があるので読み直す
        const latest = await this.userCustom.get(localId);
        delete latest.totp;
        delete latest.totpPending;
        await this.userCustom.put(localId, latest);

        await logInfo(this.request, this.env, "2fa_disable", `Disable 2FA for "${localId}"`);
    }
}
