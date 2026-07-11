import { HttpError } from "../util/HttpError";
import { normalizeStudentEmail } from "../util/member";
import { MfaService } from "../util/service/mfa";
import { RateLimiter, RATE_LIMITS } from "../util/service/rate-limit";
import { RegistrationService, RegisterBody } from "../util/service/registration";
import { createJsonResponse, logInfo } from "../util/utils";
import { IController } from "./IController";

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
            case "google":
                return await this.google();
            case "linkGoogle":
                return await this.linkGoogle();
            case "unlinkGoogle":
                return await this.unlinkGoogle();
            case "providers":
                return await this.providers();
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

    private get mfa(): MfaService {
        return new MfaService(this.env, this.request!);
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

        const exists = await this.firebase?.existUser(this.normalizeEmail(email));
        return createJsonResponse({ exists });
    }

    /**
     * ユーザーを登録する
     */
    public async register() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        if (!this.firebase) throw HttpError.createInternalServerError("Firebase service not initialized");

        const body = await this.request.json() as RegisterBody;
        const data = await new RegistrationService(this.env, this.request, this.firebase).register(body);

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

        // 2段階認証が有効なら、コードを検証するまでトークンを渡さない
        const pending = await this.mfa.createPendingIfEnabled({
            localId: data.localId,
            email,
            idToken: data.idToken,
            refreshToken: data.refreshToken,
            displayName: data.displayName
        });

        if (pending) {
            await logInfo(this.request, this.env, "login", `Login "${email}" awaiting 2FA`);
            return createJsonResponse({ success: true, mfaRequired: true, ...pending });
        }

        await logInfo(this.request, this.env, "login", `Login "${email}"`);

        data.success = true;

        return createJsonResponse(data);
    }

    /**
     * Google の ID トークンから読み取れるメールアドレスを取り出す (署名検証はしない)。
     * ドメインの早期チェック用。本検証は signInWithIdp が署名ごと行う
     * @param credential Google ID トークン (JWT)
     */
    private peekEmail(credential: string): string | null {
        const parts = credential.split(".");
        if (parts.length < 2) return null;

        try {
            const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
            const payload = JSON.parse(json);
            return typeof payload.email === "string" ? payload.email : null;
        } catch {
            return null;
        }
    }

    /**
     * 大学 Google アカウントでのログイン/新規登録。
     * GIS が発行した ID トークンを Firebase のトークンに交換する。
     * ドメイン外・未確認メールは弾く
     */
    public async google() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        if (!this.firebase) throw HttpError.createInternalServerError("Firebase service not initialized");

        await this.rateLimit("loginIp");

        const { credential } = await this.request.json() as { credential?: string };
        if (!credential) throw new HttpError(400, "BAD_REQUEST", "credential is required");

        // 署名検証前でも、明らかにドメイン外なら Firebase アカウントを作らせずに弾く
        const claimEmail = this.peekEmail(credential);
        if (!claimEmail || !claimEmail.endsWith(this.env.ALLOWED_EMAIL_DOMAIN))
            throw HttpError.createForbidden(`Email must be from ${this.env.ALLOWED_EMAIL_DOMAIN} domain`);

        const requestUri = this.request.headers.get("Origin") ?? "https://osu-denken.github.io";
        const data: any = await this.firebase.signInWithIdp(credential, "google.com", requestUri);

        if (!data?.idToken || !data?.refreshToken) return createJsonResponse(data);

        // signInWithIdp の結果を信頼する。Google 由来はメール確認済みのはず
        if (!data.email || !data.email.endsWith(this.env.ALLOWED_EMAIL_DOMAIN) || data.emailVerified === false)
            throw HttpError.createForbidden(`Email must be a verified ${this.env.ALLOWED_EMAIL_DOMAIN} address`);

        // signInWithIdp は Google プロフィール名を displayName に載せてくる。
        // 本人が設定した表示名を優先し、Google 名で上書きしない (未設定ならフロントが学籍番号にフォールバック)
        const account = await this.firebase.verifyIdToken(data.idToken);
        data.displayName = account.displayName;

        // 既存アカウントに2段階認証が付いていれば、コード検証まではトークンを渡さない
        const pending = await this.mfa.createPendingIfEnabled({
            localId: data.localId,
            email: data.email,
            idToken: data.idToken,
            refreshToken: data.refreshToken,
            displayName: data.displayName
        });

        if (pending) {
            await logInfo(this.request, this.env, "login", `Google login "${data.email}" awaiting 2FA`);
            return createJsonResponse({ success: true, mfaRequired: true, ...pending });
        }

        await logInfo(this.request, this.env, "login", `Google login "${data.email}"`);

        data.success = true;

        return createJsonResponse(data);
    }

    /**
     * ログイン中のアカウントに大学 Google アカウントを連携する。
     * 既存のパスワードユーザーが以後ソーシャルログインも使えるようにする
     */
    public async linkGoogle() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        if (!this.firebase) throw HttpError.createInternalServerError("Firebase service not initialized");
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();

        const { credential } = await this.request.json() as { credential?: string };
        if (!credential) throw new HttpError(400, "BAD_REQUEST", "credential is required");

        const claimEmail = this.peekEmail(credential);
        if (!claimEmail || !claimEmail.endsWith(this.env.ALLOWED_EMAIL_DOMAIN))
            throw HttpError.createForbidden(`Email must be from ${this.env.ALLOWED_EMAIL_DOMAIN} domain`);

        const requestUri = this.request.headers.get("Origin") ?? "https://osu-denken.github.io";
        // idToken を渡すことで、新規サインインではなく現在のアカウントへの連携になる
        const data: any = await this.firebase.signInWithIdp(credential, "google.com", requestUri, this.authorization);

        if (data?.errorMessage || !data?.idToken)
            return createJsonResponse({ success: false, message: data?.errorMessage ?? "LINK_FAILED" });

        await logInfo(this.request, this.env, "link_google", `Link Google "${data.email}" to ${data.localId}`);

        return createJsonResponse({ success: true, idToken: data.idToken, refreshToken: data.refreshToken });
    }

    /**
     * ログイン中のアカウントに紐づくログイン手段を返す。
     * 設定画面で連携ボタンの出し分けに使う
     */
    public async providers() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        if (!this.firebase) throw HttpError.createInternalServerError("Firebase service not initialized");
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();

        const providers = await this.firebase.getSignInProviders(this.authorization);

        return createJsonResponse({
            success: true,
            hasPassword: providers.includes("password"),
            hasGoogle: providers.includes("google.com")
        });
    }

    /**
     * Google 連携を解除する。
     * ただしパスワード等の代替ログイン手段が無い場合は、解除すると二度と
     * ログインできなくなるため拒否する
     */
    public async unlinkGoogle() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        if (!this.firebase) throw HttpError.createInternalServerError("Firebase service not initialized");
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();

        const providers = await this.firebase.getSignInProviders(this.authorization);

        if (!providers.includes("google.com"))
            return createJsonResponse({ success: false, message: "NOT_LINKED" });

        // Google が唯一のログイン手段なら、外すとログイン不能になるので止める
        if (!providers.includes("password"))
            return createJsonResponse({ success: false, message: "NO_OTHER_METHOD" });

        const data: any = await this.firebase.unlinkProvider(this.authorization, "google.com");
        if (!data?.localId)
            return createJsonResponse({ success: false, message: data?.error?.message ?? "UNLINK_FAILED" });

        await logInfo(this.request, this.env, "unlink_google", `Unlink Google from ${data.localId}`);

        return createJsonResponse({ success: true });
    }

    /**
     * 2段階認証のコードを検証し、退避しておいたトークンを渡す
     */
    public async loginTotp() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        const { mfaPendingToken, code } = await this.request.json() as { mfaPendingToken?: string; code?: string };
        if (!mfaPendingToken || !code) throw new HttpError(400, "BAD_REQUEST", "mfaPendingToken and code are required");

        const tokens = await this.mfa.verifyPending(mfaPendingToken, code);

        return createJsonResponse({ success: true, ...tokens });
    }

    /**
     * 2段階認証のシークレットを発行する。この時点ではまだ有効化しない
     */
    public async totpSetup() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        const user = await this.checkAuth();
        const result = await this.mfa.setup(user.localId, user.email ?? user.localId);

        return createJsonResponse({ success: true, ...result });
    }

    /**
     * 認証アプリが正しく登録できたことをコードで確認し、2段階認証を有効化する
     */
    public async totpEnable() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        const { code } = await this.request.json() as { code?: string };
        if (!code) throw new HttpError(400, "BAD_REQUEST", "code is required");

        const user = await this.checkAuth();
        const recoveryCodes = await this.mfa.enable(user.localId, code);

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
        await this.mfa.disable(user.localId, code);

        return createJsonResponse({ success: true });
    }

    /**
     * ユーザー情報を更新する
     */
    public async update() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();

        const json: any = await this.request.json();

        // パスワードはセッションだけで変更できると乗っ取り時に締め出されるため、
        // ここでは扱わない。設定・再設定はメール確認を経る /user/resetPassword に一本化する
        const data: any = await this.firebase?.updateUser(this.authorization, json.displayName, json.photoUrl);
        data.success = true;

        await logInfo(this.request, this.env, "update_user", `Update user "${data.localId}": displayName/photoUrl`);

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
