import { HttpError } from "../util/HttpError";
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
            case "login":
                return await this.login();
            case "update":
                return await this.update();
            case "resetPassword":
                return await this.resetPassword();
            case "info":
                return await this.info();
        }

        throw HttpError.createNotFound("Endpoint not found");
    }

    private normalizeEmail(email: string): string {
        if (!email.includes("@")) email += `@ge.osaka-sandai.ac.jp`;

        if (!email.match(/@(.+?)\.osaka-sandai\.ac\.jp$/)) {
            throw new HttpError(400, "BAD_REQUEST", "Email must be from osaka-sandai.ac.jp domain");
        }

        email = email.toLowerCase();
        if (!email.startsWith("s")) {
            email = `s` + email;
        }
        return email;
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

        let { email, password, passphrase } = await this.request.json() as { email: string; password: string, passphrase: string };

        if (passphrase !== this.env.REGISTER_PASSPHRASE) {
            const localId = await this.env.INVITE_CODE.get(passphrase);
            if (!localId) {
                throw new HttpError(403, "FORBIDDEN", "Invalid passphrase or invite code");
            }
        }
        
        if (!email || !password) {
            throw new HttpError(400, "BAD_REQUEST", "email and password are required");
        }

        email = this.normalizeEmail(email);

        const data: any = await this.firebase?.registerUser(email, password);
        data.success = true;
        
        if (passphrase !== this.env.REGISTER_PASSPHRASE) 
            await this.env.INVITE_CODE.delete(passphrase);

        await logInfo(this.request, this.env, "register", `Register user "${email}" with code: ${passphrase === this.env.REGISTER_PASSPHRASE ? "REGISTER_PASSPHRASE" : passphrase}`);

        return createJsonResponse(data);
    }

    /**
     * ログインする
     */
    public async login() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();

        let { email, password } = await this.request.json() as { email: string; password: string };
        if (!email || !password) {
            throw new HttpError(400, "BAD_REQUEST", "email and password are required");
        }

        email = this.normalizeEmail(email);

        const data: any = await this.firebase?.loginUser(email, password);

        await logInfo(this.request, this.env, "login", `Login "${email}"`);

        data.success = true;

        return createJsonResponse(data);
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
     * パスワードをリセットする
     */
    public async resetPassword() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
        
        const { email } = await this.request.json() as { email?: string };
        if (!email) {
            throw new HttpError(400, "BAD_REQUEST", "email is required");
        }

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
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();

        const data: any = await this.firebase?.verifyIdToken(this.authorization);
        
        if (!data || (data.error && data.error.message === "INVALID_ID_TOKEN")) {
            throw new HttpError(401, "UNAUTHORIZED", "Invalid idToken");
        }

        if (data.disabled) {
            throw new HttpError(403, "FORBIDDEN", "User account is disabled");
        }
        
        data.success = true;
        return createJsonResponse(data);
    }
}
