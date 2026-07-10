import { HttpError } from "../util/HttpError";
import { effectivePermissions, Member } from "../util/member";
import { hasPermission, Permission } from "../util/permission";
import { FirebaseService, FirebaseUser } from "../util/service/firebase";
import { GitHubService } from "../util/service/github";
import { MemberRepository } from "../util/service/members-d1";
import { SwitchBotService } from "../util/service/swbot";

/**
 * 認証と権限解決の結果
 */
export interface AuthContext {
    user: FirebaseUser;
    member: Member;
    permissions: Permission;
}

export abstract class IController {
    public path: string[];
    public firebase: FirebaseService | null = null;
    public github: GitHubService | null = null;
    public members: MemberRepository | null = null;
    public switchbot: SwitchBotService | null = null;

    public request: Request | null = null;
    public authorization: string | null = null;
    public env: any = null;
    public url: URL | null = null;

    public ctx: any = null;

    public abstract getParentPath(): string;

    constructor(path: string[]) {
        this.path = path;
    }

    /**
     * ルーティング
     */
    public abstract route() : Promise<any> | any;

    public async toResponse() {
        const res = await this.route();
        if (res instanceof Response)
            return res;

        return new Response(res, {
            status: 200,
        });
    }

    public setServices(firebase: FirebaseService | null, github: GitHubService | null, members: MemberRepository | null, switchbot: SwitchBotService | null = null) {
        this.firebase = firebase;
        this.github = github;
        this.members = members;
        this.switchbot = switchbot;
    }

    public setRequest(request: Request) {
        this.request = request;
    }

    public setAuthorization(authorization: string | null) {
        this.authorization = authorization;
        if (this.authorization == null) return;

        this.authorization = this.authorization.replace("Bearer ", "");
    }

    public setEnv(env: any) {
        this.env = env;
    }

	public setUrl(url: URL) {
        this.url = url;
	}

    public setCtx(ctx: any) {
        this.ctx = ctx;
    }

    /**
     * 認証チェックをする
     * @returns 認証データ
     */
    protected async checkAuth(): Promise<FirebaseUser> {
        if (!this.authorization) throw HttpError.createUnauthorizedHeaderRequired();
        if (!this.firebase) throw HttpError.createInternalServerError("Firebase service not initialized");

        return await this.firebase.verifyIdToken(this.authorization);
    }

    /**
     * 認証し、名簿を引いて実効権限を求める
     * @returns 認証データと名簿と実効権限
     */
    protected async resolveAuth(): Promise<AuthContext> {
        if (!this.members) throw HttpError.createInternalServerError("Member repository not initialized");

        const user = await this.checkAuth();
        if (!user.email) throw HttpError.createUnauthorized("Email is required for permission check");
        if (!user.email.endsWith(this.env.ALLOWED_EMAIL_DOMAIN))
            throw HttpError.createBadRequest(`Email must be from ${this.env.ALLOWED_EMAIL_DOMAIN} domain`);

        const member = await this.members.requireByEmail(user.email);

        // 初回認証時に Firebase アカウントと名簿を紐づける
        if (!member.localId) await this.members.linkLocalId(member.id, user.localId);

        return { user, member, permissions: effectivePermissions(member) };
    }

    /**
     * 認証と権限をチェックする
     * @param required 必要な権限
     * @returns 認証データと名簿と実効権限
     */
    protected async checkAuthAndPermission(required: Permission): Promise<AuthContext> {
        const auth = await this.resolveAuth();

        if (!hasPermission(auth.permissions, required))
            throw HttpError.createForbidden("You are not have permissions");

        return auth;
    }
}
