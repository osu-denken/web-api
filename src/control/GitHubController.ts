import { HttpError } from "../util/HttpError";
import { Permission } from "../util/permission";
import { GitHubService } from "../util/service/github";
import { UserCustomService } from "../util/service/user-custom";
import { createJsonResponse, decrypt, encrypt, generateInviteCode, logInfo } from "../util/utils";
import { IController } from "./IController";

/** GitHub のユーザー名: 英数字とハイフン、先頭末尾はハイフン不可、1〜39文字 */
const GITHUB_USERNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

/** OAuth の state を CACHE に置くときのキー接頭辞 */
const OAUTH_STATE_PREFIX = "ghoauth:";

/**
 * GitHub 連携まわりのエンドポイント。
 * Organization への招待/参加、OAuth 接続、PAT の保存を扱う。
 */
export class GitHubController extends IController {
    public getParentPath(): string {
        return "github";
    }

    public route() {
        const action = this.path[1];

        if (action === "invite") return this.invite();
        if (action === "join") return this.join();
        if (action === "username") return this.username();
        if (action === "token") return this.token();
        if (action === "oauth") {
            if (this.path[2] === "start") return this.oauthStart();
            if (this.path[2] === "callback") return this.oauthCallback();
        }

        throw HttpError.createNotFound("Endpoint not found");
    }

    private get userCustom(): UserCustomService {
        return new UserCustomService(this.env);
    }

    /** 連携完了後に戻すサイトのオリジン */
    private get siteOrigin(): string {
        return this.env.SITE_ORIGIN || "https://osu-denken.github.io";
    }

    /** OAuth の redirect_uri。認可時とトークン交換時で完全一致させる必要がある */
    private get oauthRedirectUri(): string {
        return `${this.url!.origin}/github/oauth/callback`;
    }

    /** POST 以外を弾く */
    private requirePost() {
        if (this.request?.method !== "POST") throw HttpError.createMethodNotAllowedPostOnly();
    }

    /**
     * GitHub API のレスポンスを検証して JSON を返す。サービス未初期化や失敗は例外にする。
     * @param res fetch のレスポンス (this.github が無ければ undefined)
     * @param failMessage GitHub がメッセージを返さなかったときの既定文言
     */
    private async readGitHubResult(res: Response | undefined, failMessage: string): Promise<any> {
        if (!res) throw new HttpError(500, "INTERNAL_SERVER_ERROR", "GitHub service not available");

        const data: any = await res.json();
        if (!res.ok) throw new HttpError(res.status, res.statusText, data?.message || failMessage);

        return data;
    }

    /**
     * 暗号化した GitHub トークンをユーザーデータへ保存する。PAT と OAuth で共用。
     * @param localId Firebase Local ID
     * @param token 平文のトークン
     */
    private async saveGitHubToken(localId: string, token: string) {
        const customData = await this.userCustom.get(localId);
        customData.githubTokenEncoded = await encrypt(token, this.env.SECRET_KEY);
        await this.userCustom.put(localId, customData);
    }

    /**
     * 連携済みトークンからログイン名を取得する。未連携・失敗時は null。
     * @param localId Firebase Local ID
     */
    private async connectedLogin(localId: string): Promise<string | null> {
        const customData = await this.userCustom.get(localId);
        if (!customData.githubTokenEncoded) return null;

        try {
            const token = await decrypt(customData.githubTokenEncoded, this.env.SECRET_KEY);
            return await this.github?.getLoginForToken(token) ?? null;
        } catch {
            return null;
        }
    }

    // --- Organization への招待・参加 ---

    /**
     * 幹部がメールアドレスを指定して Organization に招待する。
     */
    public async invite() {
        this.requirePost();
        await this.checkAuthAndPermission(Permission.MemberManage);

        const { email } = await this.request!.json() as { email: string };
        if (!email) throw new HttpError(400, "BAD_REQUEST", "email is required");

        await this.readGitHubResult(await this.github?.inviteOrganization(email), "GitHub invite failed");

        return createJsonResponse({ success: true, invited: email });
    }

    /**
     * 部員が Organization への招待を受け取る。
     * 連携済みならトークンからユーザー名を自動取得し、未連携なら手入力を使う。
     * 幹部でなくても、認証済みの部員であれば自分で参加できる。
     */
    public async join() {
        this.requirePost();
        const auth = await this.resolveAuth();

        const { username } = await this.request!.json().catch(() => ({})) as { username?: string };
        const name = username?.trim() || await this.connectedLogin(auth.user.localId);
        if (!name) throw new HttpError(400, "BAD_REQUEST", "username is required");
        if (!GITHUB_USERNAME_RE.test(name)) throw new HttpError(400, "BAD_REQUEST", "Invalid GitHub username");

        const data = await this.readGitHubResult(
            await this.github?.inviteOrganizationByUsername(name), "GitHub invite failed");

        await logInfo(this.request!, this.env, "github_join",
            `Invite "${name}" to org by ${auth.member.email} (#${auth.member.id})`);

        return createJsonResponse({ success: true, username: name, state: data.state ?? "pending" });
    }

    /**
     * 連携済みの GitHub ログイン名を返す。フォームの出し分けに使う。
     */
    public async username() {
        const auth = await this.resolveAuth();

        return createJsonResponse({ success: true, username: await this.connectedLogin(auth.user.localId) });
    }

    // --- OAuth 接続 ---

    /**
     * GitHub OAuth の認可 URL を作って返す。
     * state を CACHE に保存して、コールバックで本人と紐づけられるようにする。
     */
    public async oauthStart() {
        this.requirePost();
        const auth = await this.checkAuthAndPermission(Permission.BlogEdit);

        const clientId = this.env.GITHUB_OAUTH_CLIENT_ID;
        if (!clientId) throw new HttpError(500, "NOT_CONFIGURED", "GitHub OAuth is not configured");

        // state はワンタイム。コールバックまでの10分だけ localId と結びつける
        const state = generateInviteCode(32);
        await this.env.CACHE.put(`${OAUTH_STATE_PREFIX}${state}`, auth.user.localId, { expirationTtl: 600 });

        const url = new URL("https://github.com/login/oauth/authorize");
        url.searchParams.set("client_id", clientId);
        url.searchParams.set("redirect_uri", this.oauthRedirectUri);
        url.searchParams.set("scope", this.env.GITHUB_OAUTH_SCOPE || "public_repo read:org");
        url.searchParams.set("state", state);
        url.searchParams.set("allow_signup", "false");

        return createJsonResponse({ success: true, url: url.toString() });
    }

    /**
     * GitHub からのコールバック。認可コードをトークンに交換して保存する。
     * ブラウザ遷移なので、結果はポータルの連携タブへリダイレクトで伝える。
     */
    public async oauthCallback() {
        const params = this.url!.searchParams;
        const code = params.get("code");
        const state = params.get("state");

        const redirectBack = (msg: string) =>
            Response.redirect(`${this.siteOrigin}/portal/?tab=integrations&msg=${encodeURIComponent(msg)}`, 302);

        if (!code || !state) return redirectBack("GitHub連携に失敗しました（不正なコールバック）。");

        // state を消費する。使い回しと期限切れをここで弾く
        const localId = await this.env.CACHE.get(`${OAUTH_STATE_PREFIX}${state}`);
        if (!localId) return redirectBack("GitHub連携の有効期限が切れました。もう一度お試しください。");
        await this.env.CACHE.delete(`${OAUTH_STATE_PREFIX}${state}`);

        const clientId = this.env.GITHUB_OAUTH_CLIENT_ID;
        const clientSecret = this.env.GITHUB_OAUTH_CLIENT_SECRET;
        if (!clientId || !clientSecret) return redirectBack("GitHub連携が設定されていません。");

        const token = await GitHubService.exchangeOAuthCode(clientId, clientSecret, code, this.oauthRedirectUri);
        if (!token) return redirectBack("GitHubのトークン取得に失敗しました。");

        // PAT と同じ場所に保存する。ブログ編集など既存機能はそのまま動く
        await this.saveGitHubToken(localId, token);
        await logInfo(this.request!, this.env, "github_oauth", `Connect GitHub via OAuth for ${localId}`);

        return redirectBack("GitHubアカウントと連携しました。");
    }

    // --- PAT (トークン) の CRUD ---

    /**
     * GitHub PAT の取得・設定・削除。ブログ編集権限が要る。
     */
    public async token() {
        const auth = await this.checkAuthAndPermission(Permission.BlogEdit);
        const localId = auth.user.localId;

        switch (this.request?.method) {
            case "GET": {
                const customData = await this.userCustom.get(localId);
                return createJsonResponse({ success: true, isExist: Boolean(customData.githubTokenEncoded) });
            }
            case "POST":
            case "PUT": {
                const { githubToken } = await this.request.json() as { githubToken: string };
                if (!githubToken) throw HttpError.createBadRequest("githubToken is required");

                await this.saveGitHubToken(localId, githubToken);
                await logInfo(this.request, this.env, "portal", `set github token to ${localId}`);
                return createJsonResponse({ success: true });
            }
            case "DELETE": {
                const customData = await this.userCustom.get(localId);
                delete customData.githubTokenEncoded;
                await this.userCustom.put(localId, customData);
                await logInfo(this.request!, this.env, "portal", `delete github token from ${localId}`);
                return createJsonResponse({ success: true });
            }
        }

        return createJsonResponse({ success: false });
    }
}
