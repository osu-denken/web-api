import { HttpError } from "../util/HttpError";
import { normalizeStudentEmail } from "../util/member";
import { RateLimiter, RATE_LIMITS } from "../util/service/rate-limit";
import { TurnstileService } from "../util/service/turnstile";
import { UserCustomService } from "../util/service/user-custom";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "../util/totp";
import { createJsonResponse, decrypt, encrypt, generateInviteCode, logInfo, sha256, timingSafeEqual } from "../util/utils";
import { IController } from "./IController";

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

export class UserController extends IController {
    public getParentPath(): string {
        return "user";
    }

    public constructor(path: string[]) {
        super(path);
        if (path.length < 2) path[1] = "info";
    }

    public async route() {
        switch (this.path[1]) {
            case "exists":
                return await this.exists();
            case "register":
                return await this.register();
            case "verifyEmail":
                return await this.verifyEmail();
            case "login":
                return await this.login();
            case "loginTotp":
                return await this.loginTotp();
            case "totp":
                return await this.totp();
            case "update":
                return await this.update();
            case "resetPassword":
                return await this.resetPassword();
            case "info":
                return await this.info();
            case "refresh":
                return await this.refresh();
        }

        throw HttpError.createNotFound("Endpoint not found");
    }

    private get userCustom(): UserCustomService {
        return new UserCustomService(this.env);
    }

    /**
     * 総当たりを防ぐ。回数を数えるのは検証の前
     * @param action RATE_LIMITS のキー
     * @param subject 数える単位。省略すると接続元IPで数える
     */
    private async rateLimit(action: keyof typeof RATE_LIMITS, subject?: string): Promise<void> {
        await new RateLimiter(this.env).consume(this.request!, action, subject);
    }

    /**
     * 2段階認証の登録・解除
     */
    private async totp() {
        switch (this.path[2]) {
            case "setup":
                return await this.totpSetup();
            case "enable":
                return await this.totpEnable();
            case "disable":
                return await this.totpDisable();
        }

        throw HttpError.createNotFound("Endpoint not found");
    }

    private normalizeEmail(email: string): string {
        return normalizeStudentEmail(email, this.env.ALLOWED_EMAIL_DOMAIN);
    }

    /**
     * ユーザーが存在するかどうかを確認する
     */
    public async exists() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        
        let { email } = await this.request.json() as { email: string };
        if (!email) throw new HttpError(400, "BAD_REQUEST", "email is required");

        email = this.normalizeEmail(email);

        const exists = await this.firebase?.existUser(email);
        return createJsonResponse({ exists });
    }

    /**
     * ユーザーを登録する
     */
    public async register() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        await this.rateLimit("registerIp");

        let { email, password, passphrase, turnstileToken } = await this.request.json() as
            { email: string; password: string, passphrase: string, turnstileToken?: string };

        // 合言葉も招待コードも無ければ自己登録。誰でも仮登録できるが、
        // 大学のメールボックスを開けることを確認メールで確かめてもらう。
        // 空の合言葉・空のシークレットをマスター一致と誤認しないよう、両方が非空であることを要る
        const isMasterPassphrase = Boolean(passphrase) && Boolean(this.env.REGISTER_PASSPHRASE)
            && timingSafeEqual(passphrase, this.env.REGISTER_PASSPHRASE);
        const isInvite = !isMasterPassphrase && Boolean(passphrase) && Boolean(await this.env.INVITE_CODE.get(passphrase));
        const isSelfRegister = !isMasterPassphrase && !isInvite;

        if (isSelfRegister && passphrase)
            throw new HttpError(403, "FORBIDDEN", "Invalid passphrase or invite code");

        // 招待経由は部員が門番になっているので、bot 確認は開かれた自己登録にだけ課す
        if (isSelfRegister)
            await new TurnstileService(this.env.TURNSTILE_SECRET_KEY)
                .verify(turnstileToken, this.request.headers.get("CF-Connecting-IP"));

        if (!email || !password) {
            throw new HttpError(400, "BAD_REQUEST", "email and password are required");
        }

        email = this.normalizeEmail(email);

        await this.rateLimit("register", email);

        const data: any = await this.firebase?.registerUser(email, password);
        data.success = true;

        // 自己登録は本人確認が済んでいないので、確認メールを送って verified を待つ
        if (isSelfRegister && data.idToken) {
            await this.firebase?.sendVerifyEmail(data.idToken);
            data.verificationRequired = true;
        }

        if (isInvite)
            await this.env.INVITE_CODE.delete(passphrase);

        const via = isMasterPassphrase ? "REGISTER_PASSPHRASE" : isInvite ? passphrase : "self-register";
        await logInfo(this.request, this.env, "register", `Register user "${email}" with code: ${via}`);

        return createJsonResponse(data);
    }

    /**
     * ログイン中のユーザーへ確認メールを送り直す
     */
    public async verifyEmail() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();

        await this.rateLimit("registerIp");

        await this.firebase?.sendVerifyEmail(this.authorization);

        return createJsonResponse({ success: true });
    }

    /**
     * ログインする
     */
    public async login() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        await this.rateLimit("loginIp");

        let { email, password } = await this.request.json() as { email: string; password: string };
        if (!email || !password) {
            throw new HttpError(400, "BAD_REQUEST", "email and password are required");
        }

        email = this.normalizeEmail(email);

        await this.rateLimit("login", email);

        const data: any = await this.firebase?.loginUser(email, password);

        // 認証情報が誤っていれば Firebase のエラーをそのまま返す
        if (!data?.idToken || !data?.refreshToken) return createJsonResponse(data);

        const customData = await this.userCustom.get(data.localId);

        // 2段階認証が有効なら、コードを検証するまでトークンを渡さない
        if (customData.totp) {
            const pendingToken = generateInviteCode(32);
            const pending: MfaPending = {
                localId: data.localId,
                email,
                idToken: data.idToken,
                refreshToken: data.refreshToken,
                displayName: data.displayName,
                attempts: 0
            };

            await this.env.CACHE.put(this.mfaKey(pendingToken), JSON.stringify(pending), { expirationTtl: MFA_PENDING_TTL });

            await logInfo(this.request, this.env, "login", `Login "${email}" awaiting 2FA`);

            return createJsonResponse({
                success: true,
                mfaRequired: true,
                mfaPendingToken: pendingToken,
                expiresIn: MFA_PENDING_TTL
            });
        }

        await logInfo(this.request, this.env, "login", `Login "${email}"`);

        data.success = true;

        return createJsonResponse(data);
    }

    private mfaKey(pendingToken: string): string {
        return `mfa:${pendingToken}`;
    }

    /**
     * 2段階認証のコードを検証し、退避しておいたトークンを渡す
     */
    public async loginTotp() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        const { mfaPendingToken, code } = await this.request.json() as { mfaPendingToken?: string; code?: string };
        if (!mfaPendingToken || !code) throw new HttpError(400, "BAD_REQUEST", "mfaPendingToken and code are required");

        const key = this.mfaKey(mfaPendingToken);
        const raw = await this.env.CACHE.get(key);
        if (!raw) throw new HttpError(401, "MFA_PENDING_EXPIRED", "2FA session expired, please login again");

        const pending: MfaPending = JSON.parse(raw);

        const customData = await this.userCustom.get(pending.localId);
        if (!customData.totp) {
            // 待機中に 2段階認証が解除された。トークンをそのまま渡してよい
            await this.env.CACHE.delete(key);
            return createJsonResponse({ success: true, idToken: pending.idToken, refreshToken: pending.refreshToken, displayName: pending.displayName });
        }

        const secret = await decrypt(customData.totp.secretEncoded, this.env.SECRET_KEY);
        const step = await verifyTotp(secret, code, customData.totp.lastUsedStep);

        const usedRecoveryCode = step === null && await this.consumeRecoveryCode(pending.localId, code);

        if (step === null && !usedRecoveryCode) {
            pending.attempts++;

            if (pending.attempts >= MFA_MAX_ATTEMPTS) {
                await this.env.CACHE.delete(key);
                await logInfo(this.request, this.env, "login_2fa", `2FA locked out for "${pending.email}"`);
                throw new HttpError(401, "MFA_TOO_MANY_ATTEMPTS", "Too many attempts, please login again");
            }

            // 残り試行回数を保つため、TTL は延ばさず書き戻す
            await this.env.CACHE.put(key, JSON.stringify(pending), { expirationTtl: MFA_PENDING_TTL });
            throw new HttpError(401, "MFA_INVALID_CODE", "Invalid code");
        }

        if (step !== null) {
            customData.totp.lastUsedStep = step;
            await this.userCustom.put(pending.localId, customData);
        }

        await this.env.CACHE.delete(key);

        await logInfo(this.request, this.env, "login_2fa",
            `Login "${pending.email}" with ${usedRecoveryCode ? "recovery code" : "2FA"}`);

        return createJsonResponse({
            success: true,
            idToken: pending.idToken,
            refreshToken: pending.refreshToken,
            displayName: pending.displayName,
            usedRecoveryCode: Boolean(usedRecoveryCode)
        });
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
     * 2段階認証のシークレットを発行する。この時点ではまだ有効化しない
     */
    public async totpSetup() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        const user = await this.checkAuth();
        const customData = await this.userCustom.get(user.localId);

        if (customData.totp) throw new HttpError(409, "MFA_ALREADY_ENABLED", "2FA is already enabled");

        const secret = generateTotpSecret();
        customData.totpPending = {
            secretEncoded: await encrypt(secret, this.env.SECRET_KEY),
            createdAt: new Date().toISOString()
        };
        await this.userCustom.put(user.localId, customData);

        return createJsonResponse({
            success: true,
            secret,
            otpauthUrl: otpauthUrl(secret, user.email ?? user.localId, TOTP_ISSUER)
        });
    }

    /**
     * 認証アプリが正しく登録できたことをコードで確認し、2段階認証を有効化する
     */
    public async totpEnable() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        const { code } = await this.request.json() as { code?: string };
        if (!code) throw new HttpError(400, "BAD_REQUEST", "code is required");

        const user = await this.checkAuth();
        const customData = await this.userCustom.get(user.localId);

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

        await this.userCustom.put(user.localId, customData);

        await logInfo(this.request, this.env, "2fa_enable", `Enable 2FA for "${user.localId}"`);

        return createJsonResponse({ success: true, recoveryCodes });
    }

    /**
     * 2段階認証を解除する
     */
    public async totpDisable() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        const { code } = await this.request.json() as { code?: string };
        if (!code) throw new HttpError(400, "BAD_REQUEST", "code is required");

        const user = await this.checkAuth();
        const customData = await this.userCustom.get(user.localId);

        if (!customData.totp) throw new HttpError(400, "MFA_NOT_ENABLED", "2FA is not enabled");

        // 解除は乗っ取り時の足がかりになるので、有効化と同じくコードの提示を求める
        const secret = await decrypt(customData.totp.secretEncoded, this.env.SECRET_KEY);
        const step = await verifyTotp(secret, code, customData.totp.lastUsedStep);

        if (step === null && !await this.consumeRecoveryCode(user.localId, code))
            throw new HttpError(400, "MFA_INVALID_CODE", "Invalid code");

        // consumeRecoveryCode が書き換えている可能性があるので読み直す
        const latest = await this.userCustom.get(user.localId);
        delete latest.totp;
        delete latest.totpPending;
        await this.userCustom.put(user.localId, latest);

        await logInfo(this.request, this.env, "2fa_disable", `Disable 2FA for "${user.localId}"`);

        return createJsonResponse({ success: true });
    }

    /**
     * ユーザー情報を更新する
     */
    public async update() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();

        const json: any = await this.request.json();

        const data: any = await this.firebase?.updateUser(this.authorization, json.displayName, json.photoUrl, json.password);
        data.success = true;

        await logInfo(this.request, this.env, "update_user", `Update user "${data.localId}": ${JSON.stringify(json, null, 2)}`);

        return createJsonResponse(data);
    }

    /**
     * トークンをリフレッシュする
     */
    public async refresh() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        
        const { refreshToken } = await this.request.json() as { refreshToken?: string };
        if (!refreshToken) {
            throw new HttpError(400, "BAD_REQUEST", "refreshToken is required");
        }

        const data: any = await this.firebase?.refreshToken(refreshToken);
        
        if (data.error) {
            throw new HttpError(401, "UNAUTHORIZED", data.error.message);
        }

        const result = {
            idToken: data.id_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in,
            tokenType: data.token_type,
            userId: data.user_id,
            projectId: data.project_id
        }

        await logInfo(this.request, this.env, "refresh_token", `Refresh token for "${result.userId}"`);

        return createJsonResponse(result);
    }

    /**
     * パスワードをリセットする
     */
    public async resetPassword() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        await this.rateLimit("resetPasswordIp");

        const { email } = await this.request.json() as { email?: string };
        if (!email) {
            throw new HttpError(400, "BAD_REQUEST", "email is required");
        }

        await this.rateLimit("resetPassword", email.trim().toLowerCase());

        const data: any = await this.firebase?.resetPassword(email);
        data.success = true;

        await logInfo(this.request, this.env, "reset_password", `Reset password for "${email}"`);

        return createJsonResponse(data);
    }

    /**
     * ユーザー情報、メールアドレスやディスプレイネーム、作成日時といった情報を取得する
     */
    public async info() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        const user = await this.checkAuth();

        return createJsonResponse({ ...user, success: true });
    }
}
